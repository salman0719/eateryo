import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DELETE as deleteAccountRoute } from "@/app/api/account/route";
import {
  DELETE as restoreSuspensionRoute,
  POST as suspendSuspensionRoute,
} from "@/app/api/admin/accounts/[id]/suspension/route";
import { POST as placeOrderRoute } from "@/app/api/orders/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { getPublishedMenuByPath, publishMenuForUser } from "@/features/publishing/repo";
import { setRestaurantSlugForUser } from "@/features/tables/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { AccountStateError, assertAccountActive, openSuspension } from "@/lib/auth/account-state";
import { createAuth } from "@/lib/auth";
import { grantPlatformAdmin } from "@/lib/auth/platform-admin";
import { restoreAccount, suspendAccount } from "@/features/platform/repo";
import {
  accountSuspension,
  platformEvent,
  publishedMenu,
  session as sessionTable,
  user,
  type PlatformEventAction,
} from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * B1 — suspension + audit base (PGlite, no external services).
 *
 * The plan's list: the partial index holds; sign-in is denied through the
 * real auth hook; sessions die on suspend; a second suspend conflicts;
 * restore re-allows sign-in; the audit row is written exactly once per
 * action; diner ordering and the published page keep working while the
 * owner is suspended.
 *
 * Route coverage pins the suspension endpoint's own contract (guard
 * matrix, body validation, conflict/restore codes, no-store) and one
 * end-to-end suspended-write refusal through a real café handler.
 */

const holder: {
  db: TestDb | null;
  userId: string | null;
  sessionUser: { id: string; email: string } | null;
} = { db: null, userId: null, sessionUser: null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
  getSessionUser: vi.fn(async () => holder.sessionUser),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

const BASE_URL = "http://localhost:3000/api/auth";

let db: TestDb;
let auth: ReturnType<typeof createAuth>;
const sentLinks: string[] = [];

let operatorId: string;
const OPERATOR_EMAIL = "suspend-op@cafe.test";

beforeAll(async () => {
  ({ db } = await createTestDb());
  holder.db = db;
  auth = createAuth({
    db,
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
    sendMagicLink: async ({ url }) => {
      sentLinks.push(url);
    },
  });
  operatorId = await seedUser(db, OPERATOR_EMAIL, "Operator");
  await grantPlatformAdmin(db, { userId: operatorId });
}, 30_000);

async function requestMagicLink(email: string): Promise<string> {
  const request = await auth.handler(
    new Request(`${BASE_URL}/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    })
  );
  expect(request.status).toBe(200);
  const url = sentLinks[sentLinks.length - 1];
  if (!url) throw new Error("no magic link captured");
  return url;
}

function sessionCookies(res: Response): string[] {
  return res.headers.getSetCookie().filter((c) => c.toLowerCase().includes("session"));
}

async function seedTarget(tag: string): Promise<{ id: string; email: string }> {
  const email = `suspend-target-${tag}@cafe.test`;
  const id = await seedUser(db, email, `Target ${tag}`);
  return { id, email };
}

function suspensionRequest(targetId: string, body: unknown, init?: RequestInit): Request {
  return new Request(`http://test.local/api/admin/accounts/${targetId}/suspension`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

function suspensionParams(targetId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: targetId }) };
}

async function openSuspensionCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: accountSuspension.id })
    .from(accountSuspension)
    .where(and(eq(accountSuspension.userId, userId), isNull(accountSuspension.liftedAt)));
  return rows.length;
}

async function eventCount(targetUserId: string, action: PlatformEventAction): Promise<number> {
  const rows = await db
    .select({ id: platformEvent.id })
    .from(platformEvent)
    .where(and(eq(platformEvent.targetUserId, targetUserId), eq(platformEvent.action, action)));
  return rows.length;
}

describe("suspension state helpers", () => {
  it("reads clear when nothing is open and throws with generic copy when suspended", async () => {
    const target = await seedTarget("helpers");
    expect(await openSuspension(db, target.id)).toBeNull();
    await assertAccountActive(db, target.id);

    await suspendAccount(db, {
      targetUserId: target.id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    const open = await openSuspension(db, target.id);
    expect(open?.reason).toBe("abuse_or_spam");

    await expect(assertAccountActive(db, target.id)).rejects.toBeInstanceOf(AccountStateError);
    await assertAccountActive(db, target.id).catch((error: unknown) => {
      expect(error).toBeInstanceOf(AccountStateError);
      const message = (error as Error).message;
      expect(message.toLowerCase()).toContain("suspended");
      // The reason stays internal: the copy never names it.
      expect(message).not.toContain("abuse_or_spam");
    });
  });
});

describe("suspend/restore repository", () => {
  it("suspends atomically: open row, sessions deleted, one audit event", async () => {
    const target = await seedTarget("atomic");
    await db.insert(sessionTable).values([
      {
        id: "sess-atomic-1",
        userId: target.id,
        token: "tok-atomic-1",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      {
        id: "sess-atomic-2",
        userId: target.id,
        token: "tok-atomic-2",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ]);

    const result = await suspendAccount(db, {
      targetUserId: target.id,
      reason: "owner_request",
      note: "Ownership changing hands.",
      actorUserId: operatorId,
    });

    expect(result.suspension.reason).toBe("owner_request");
    expect(result.suspension.note).toBe("Ownership changing hands.");
    expect(result.sessionsRevoked).toBe(2);
    expect(await openSuspensionCount(target.id)).toBe(1);
    expect(
      (await db.select().from(sessionTable).where(eq(sessionTable.userId, target.id))).length
    ).toBe(0);
    expect(await eventCount(target.id, "account.suspended")).toBe(1);

    const events = await db
      .select({
        action: platformEvent.action,
        actorEmail: platformEvent.actorEmail,
        targetEmail: platformEvent.targetEmail,
      })
      .from(platformEvent)
      .where(eq(platformEvent.targetUserId, target.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "account.suspended",
      actorEmail: OPERATOR_EMAIL,
      targetEmail: target.email,
    });
  });

  it("refuses a second open suspension as a conflict", async () => {
    const target = await seedTarget("conflict");
    await suspendAccount(db, {
      targetUserId: target.id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    await expect(
      suspendAccount(db, {
        targetUserId: target.id,
        reason: "other",
        actorUserId: operatorId,
      })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "suspension_active" });
    expect(await openSuspensionCount(target.id)).toBe(1);
  });

  it("restores atomically and keeps the history row with its reason", async () => {
    const target = await seedTarget("restore");
    await suspendAccount(db, {
      targetUserId: target.id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    const restored = await restoreAccount(db, {
      targetUserId: target.id,
      note: "Appeal upheld.",
      actorUserId: operatorId,
    });
    expect(await openSuspensionCount(target.id)).toBe(0);
    expect(await eventCount(target.id, "account.restored")).toBe(1);
    expect(await eventCount(target.id, "account.suspended")).toBe(1);

    const rows = await db
      .select({
        reason: accountSuspension.reason,
        liftedAt: accountSuspension.liftedAt,
        liftNote: accountSuspension.liftNote,
      })
      .from(accountSuspension)
      .where(eq(accountSuspension.userId, target.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "abuse_or_spam",
      liftNote: "Appeal upheld.",
    });
    expect(rows[0]!.liftedAt).toBeInstanceOf(Date);
    expect(restored.suspensionId).toBeTruthy();
  });

  it("restore with nothing open and unknown accounts read as not found", async () => {
    const target = await seedTarget("empty-restore");
    await expect(
      restoreAccount(db, { targetUserId: target.id, actorUserId: operatorId })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "no_open_suspension" });
    await expect(
      suspendAccount(db, {
        targetUserId: "00000000-0000-0000-0000-000000000000",
        reason: "other",
        actorUserId: operatorId,
      })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_found" });
  });

  it("holds one open suspension per account at the database level", async () => {
    const target = await seedTarget("partial-index");
    await db.insert(accountSuspension).values({
      userId: target.id,
      reason: "other",
      suspendedBy: operatorId,
    });
    await expect(
      db.insert(accountSuspension).values({
        userId: target.id,
        reason: "other",
        suspendedBy: operatorId,
      })
    ).rejects.toThrow();
    expect(await openSuspensionCount(target.id)).toBe(1);
  });
});

describe("sign-in gate through the real auth hook", () => {
  it("mints no session for a suspended account", async () => {
    const target = await seedTarget("hook-deny");
    await suspendAccount(db, {
      targetUserId: target.id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });

    const url = await requestMagicLink(target.email);
    const verify = await auth.handler(new Request(url));
    expect(verify.status).toBe(403);
    expect(sessionCookies(verify)).toHaveLength(0);

    // The link is consumed even though no session was minted: replay mints nothing.
    const replay = await auth.handler(new Request(url));
    expect(sessionCookies(replay)).toHaveLength(0);

    // The account itself is untouched — suspension is not deletion.
    expect((await db.select().from(user).where(eq(user.id, target.id))).length).toBe(1);
  });

  it("deletes live sessions on suspend and restores sign-in on restore", async () => {
    const target = await seedTarget("hook-cycle");
    const before = await auth.handler(new Request(await requestMagicLink(target.email)));
    const cookieHeader = before.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(sessionCookies(before).length).toBeGreaterThan(0);

    await suspendAccount(db, {
      targetUserId: target.id,
      reason: "owner_request",
      actorUserId: operatorId,
    });
    expect(
      (await db.select().from(sessionTable).where(eq(sessionTable.userId, target.id))).length
    ).toBe(0);

    const gated = await auth.handler(
      new Request(`${BASE_URL}/get-session`, { headers: { cookie: cookieHeader } })
    );
    // A revoked session answers as signed out (null user or null body).
    const gatedPayload = (await gated.json()) as { user?: unknown } | null;
    expect(gatedPayload?.user ?? null).toBeNull();

    await restoreAccount(db, { targetUserId: target.id, actorUserId: operatorId });
    const after = await auth.handler(new Request(await requestMagicLink(target.email)));
    expect(sessionCookies(after).length).toBeGreaterThan(0);
  }, 30_000);
});

describe("diner paths while the owner is suspended", () => {
  const menuId = "menu-suspended-owner";
  let restaurantSlug: string;
  let menuSlug: string;
  /** The exact document that was stored + published (ids are random per build). */
  let seededDoc: MenuDocument;

  function menuDoc(): MenuDocument {
    return menuDocumentSchema.parse({
      ...createSampleMenuDocument(),
      id: menuId,
      title: "Suspended Owner Menu",
      currency: "USD",
    });
  }

  beforeAll(async () => {
    const owner = await seedTarget("diner-owner");
    const restaurant = await createRestaurant(db, owner.id, "Suspended Café");
    // Slugs are claimed on demand, not at creation: claim it like the app does.
    await setRestaurantSlugForUser(db, owner.id, restaurant.id, "suspended-cafe");
    restaurantSlug = "suspended-cafe";
    holder.userId = owner.id;
    seededDoc = menuDoc();
    await createMenuForUser(db, owner.id, restaurant.id, seededDoc);
    await publishMenuForUser(db, owner.id, menuId);
    const published = await db
      .select({ slug: publishedMenu.slug })
      .from(publishedMenu)
      .where(eq(publishedMenu.menuId, menuId))
      .limit(1);
    if (!published[0]) throw new Error("published menu row missing");
    menuSlug = published[0].slug;
    await suspendAccount(db, {
      targetUserId: owner.id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    holder.userId = null;
  }, 30_000);

  it("still takes a diner order against the published snapshot", async () => {
    // The seeded document, not a fresh build: item ids are random per build.
    const item = seededDoc.categories
      .flatMap((category) => category.items)
      .find((candidate) => candidate.available !== false)!;
    const res = await placeOrderRoute(
      new Request("http://test.local/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
        body: JSON.stringify({
          restaurantSlug,
          slug: menuSlug,
          tableLabel: "4",
          lines: [
            {
              menuItemId: item.id,
              ...(item.variants.length > 0 ? { variantName: item.variants[0]!.name } : {}),
              quantity: 1,
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as { order: { status: string } };
    expect(order.status).toBe("new");
  });

  it("still serves the published page read", async () => {
    const page = await getPublishedMenuByPath(db, restaurantSlug, menuSlug);
    expect(page).not.toBeNull();
    expect(page!.doc.categories.length).toBeGreaterThan(0);
  });
});

describe("suspension API route", () => {
  it("suspends and restores with the operator guard, audited", async () => {
    const target = await seedTarget("api-happy");
    holder.sessionUser = { id: operatorId, email: OPERATOR_EMAIL };

    const suspend = await suspendSuspensionRoute(
      suspensionRequest(target.id, { reason: "abuse_or_spam", note: "41 bad orders." }),
      suspensionParams(target.id)
    );
    expect(suspend.status).toBe(200);
    expect(suspend.headers.get("Cache-Control")).toBe("no-store");
    const suspended = (await suspend.json()) as {
      suspension: { reason: string };
      sessionsRevoked: number;
    };
    expect(suspended.suspension.reason).toBe("abuse_or_spam");
    expect(suspended.sessionsRevoked).toBe(0);
    expect(await eventCount(target.id, "account.suspended")).toBe(1);

    const again = await suspendSuspensionRoute(
      suspensionRequest(target.id, { reason: "other" }),
      suspensionParams(target.id)
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "suspension_active"
    );

    const restore = await restoreSuspensionRoute(
      new Request(`http://test.local/api/admin/accounts/${target.id}/suspension`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "Cleared." }),
      }),
      suspensionParams(target.id)
    );
    expect(restore.status).toBe(200);
    expect(restore.headers.get("Cache-Control")).toBe("no-store");
    expect(await eventCount(target.id, "account.restored")).toBe(1);

    const empty = await restoreSuspensionRoute(
      new Request(`http://test.local/api/admin/accounts/${target.id}/suspension`, {
        method: "DELETE",
      }),
      suspensionParams(target.id)
    );
    expect(empty.status).toBe(404);
    expect(((await empty.json()) as { error: { code: string } }).error.code).toBe(
      "no_open_suspension"
    );
  });

  it("validates the body and the target id", async () => {
    const target = await seedTarget("api-validation");
    holder.sessionUser = { id: operatorId, email: OPERATOR_EMAIL };

    const missing = await suspendSuspensionRoute(
      suspensionRequest(target.id, {}),
      suspensionParams(target.id)
    );
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("invalid_body");

    const oversized = await suspendSuspensionRoute(
      suspensionRequest(target.id, { reason: "other", note: "x".repeat(501) }),
      suspensionParams(target.id)
    );
    expect(oversized.status).toBe(400);

    const unknown = await suspendSuspensionRoute(
      suspensionRequest("00000000-0000-0000-0000-000000000000", { reason: "other" }),
      suspensionParams("00000000-0000-0000-0000-000000000000")
    );
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("holds the guard matrix: signed-out 401, non-operator 404, cross-site 403", async () => {
    const target = await seedTarget("api-guard");
    const body = { reason: "other" };

    holder.sessionUser = null;
    const signedOut = await suspendSuspensionRoute(
      suspensionRequest(target.id, body),
      suspensionParams(target.id)
    );
    expect(signedOut.status).toBe(401);

    holder.sessionUser = { id: target.id, email: target.email };
    const nonOperator = await suspendSuspensionRoute(
      suspensionRequest(target.id, body),
      suspensionParams(target.id)
    );
    expect(nonOperator.status).toBe(404);
    expect(((await nonOperator.json()) as { error: { code: string } }).error.code).toBe(
      "not_found"
    );

    holder.sessionUser = { id: operatorId, email: OPERATOR_EMAIL };
    const crossSite = await suspendSuspensionRoute(
      suspensionRequest(target.id, body, {
        headers: {
          "content-type": "application/json",
          origin: "https://evil.test",
        },
      }),
      suspensionParams(target.id)
    );
    expect(crossSite.status).toBe(403);
    expect(((await crossSite.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_rejected"
    );
  });
});

describe("suspended owner writes through a real handler", () => {
  it("refuses account deletion with 403 and no reason leaked", async () => {
    const target = await seedTarget("write-guard");
    await suspendAccount(db, {
      targetUserId: target.id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    holder.userId = target.id;

    const res = await deleteAccountRoute(
      new Request("http://test.local/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "delete my account" }),
      })
    );
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("account_suspended");
    expect(payload.error.message).not.toContain("abuse_or_spam");
    // The refused write changed nothing.
    expect((await db.select().from(user).where(eq(user.id, target.id))).length).toBe(1);
  });
});

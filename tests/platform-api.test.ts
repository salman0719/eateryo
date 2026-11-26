import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { POST as resetAccessRoute } from "@/app/api/admin/accounts/[id]/access/reset/route";
import { POST as unlockAccessRoute } from "@/app/api/admin/accounts/[id]/access/unlock/route";
import { GET as getAccounts } from "@/app/api/admin/accounts/route";
import { GET as getAccount } from "@/app/api/admin/accounts/[id]/route";
import {
  DELETE as restoreAccountRoute,
  POST as suspendRoute,
} from "@/app/api/admin/accounts/[id]/suspension/route";
import { GET as getEvents } from "@/app/api/admin/events/route";
import { grantPlatformAdmin } from "@/lib/auth/platform-admin";
import {
  accountAccessState,
  platformEvent,
  session as sessionTable,
  type PlatformEventAction,
} from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * B3 API contracts: the admin HTTP surface refuses what it must and leaks
 * nothing. Cross-origin mutations → 403; missing reason → 400; oversized
 * note → 400; unknown id → 404; every response is `no-store`; error bodies
 * never carry SQL or stack traces.
 *
 * Real handlers on PGlite; only the session cookie and the DB handle are
 * stubbed (the repo + guard run for real).
 */

const holder: { db: TestDb | null; userId: string | null } = {
  db: null,
  userId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => (holder.userId ? { id: holder.userId } : null)),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

function adminRequest(path: string, init: RequestInit = {}, origin?: string): Request {
  const headers = new Headers(init.headers);
  if (origin) headers.set("origin", origin);
  return new Request(`http://test.local${path}`, { ...init, headers });
}

function mutationBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** An error payload must read as a message, not as internals. */
function expectCleanError(payload: unknown): void {
  const text = JSON.stringify(payload);
  expect(text).not.toMatch(/select\s|insert\s|drizzle|pgtable|neon|stack|Error:/i);
  const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
  expect(typeof error?.code).toBe("string");
  expect(typeof error?.message).toBe("string");
}

function expectNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toContain("no-store");
}

async function accessEventCount(
  db: TestDb,
  targetUserId: string,
  action: PlatformEventAction
): Promise<number> {
  const rows = await db
    .select({ id: platformEvent.id })
    .from(platformEvent)
    .where(and(eq(platformEvent.targetUserId, targetUserId), eq(platformEvent.action, action)));
  return rows.length;
}

describe("platform admin API contracts", () => {
  let operatorId: string;
  let targetId: string;

  beforeAll(async () => {
    const { db } = await createTestDb();
    holder.db = db;
    operatorId = await seedUser(db, "contract-operator@platform.test", "Contract Operator");
    targetId = await seedUser(db, "contract-target@platform.test", "Contract Target");
    expect(await grantPlatformAdmin(db, { userId: operatorId })).toMatchObject({
      status: "granted",
    });
    holder.userId = operatorId;
  }, 30_000);

  it("refuses a cross-origin suspend with 403 before the guard runs", async () => {
    const response = await suspendRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/suspension`,
        mutationBody({ reason: "abuse_or_spam" }),
        "https://evil.test"
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toEqual({
      error: { code: "cross_origin_rejected", message: expect.any(String) },
    });
  });

  it("refuses a cross-origin restore with 403", async () => {
    const response = await restoreAccountRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/suspension`,
        { method: "DELETE" },
        "https://evil.test"
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(403);
  });

  it("refuses a suspend with no reason with 400 and a clean body", async () => {
    const response = await suspendRoute(
      adminRequest(`/api/admin/accounts/${targetId}/suspension`, mutationBody({})),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expectCleanError(payload);
    expectNoStore(response);
  });

  it("refuses a suspend with an oversized note with 400", async () => {
    const response = await suspendRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/suspension`,
        mutationBody({ reason: "owner_request", note: "x".repeat(501) })
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(400);
    expectCleanError(await response.json());
    expectNoStore(response);
  });

  it("answers an unknown account with 404 and no internals", async () => {
    const detail = await getAccount(adminRequest("/api/admin/accounts/no-such-user"), {
      params: Promise.resolve({ id: "no-such-user" }),
    });
    expect(detail.status).toBe(404);
    expectCleanError(await detail.json());
    expectNoStore(detail);

    const suspend = await suspendRoute(
      adminRequest(
        "/api/admin/accounts/no-such-user/suspension",
        mutationBody({ reason: "other" })
      ),
      { params: Promise.resolve({ id: "no-such-user" }) }
    );
    expect(suspend.status).toBe(404);
    expectCleanError(await suspend.json());
    expectNoStore(suspend);
  });

  it("rejects a forged page cursor with 400", async () => {
    const response = await getAccounts(
      adminRequest("/api/admin/accounts?cursor=!!!not-a-cursor!!!")
    );
    expect(response.status).toBe(400);
    expectCleanError(await response.json());
    expectNoStore(response);
  });

  it("forces a password reset over HTTP: revokes sessions and audits once", async () => {
    const db = holder.db!;
    const email = "contract-reset@platform.test";
    const targetId = await seedUser(db, email, "Contract Reset");
    await db.insert(sessionTable).values({
      id: "sess-contract-reset-1",
      userId: targetId,
      token: "tok-contract-reset-1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const response = await resetAccessRoute(
      adminRequest(`/api/admin/accounts/${targetId}/access/reset`, { method: "POST" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(200);
    expectNoStore(response);
    const payload = (await response.json()) as {
      reset: { resetSentAt: string };
      sessionsRevoked: number;
    };
    expect(payload.sessionsRevoked).toBe(1);
    expect(typeof payload.reset.resetSentAt).toBe("string");
    expect(
      (await db.select().from(sessionTable).where(eq(sessionTable.userId, targetId))).length
    ).toBe(0);
    expect(await accessEventCount(db, targetId, "password.reset")).toBe(1);
  });

  it("refuses a cross-origin reset with 403 before the guard runs", async () => {
    const response = await resetAccessRoute(
      adminRequest(
        `/api/admin/accounts/${targetId}/access/reset`,
        { method: "POST" },
        "https://evil.test"
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_rejected"
    );
  });

  it("answers an unknown reset with 404 and no internals", async () => {
    const response = await resetAccessRoute(
      adminRequest("/api/admin/accounts/no-such-user/access/reset", { method: "POST" }),
      { params: Promise.resolve({ id: "no-such-user" }) }
    );
    expect(response.status).toBe(404);
    const payload = await response.json();
    expectCleanError(payload);
    expect(payload).toEqual({
      error: { code: "not_found", message: expect.any(String) },
    });
    expectNoStore(response);
  });

  it("holds the reset guard matrix: signed-out 401, non-operator 404", async () => {
    const previous = holder.userId;
    try {
      holder.userId = null;
      const signedOut = await resetAccessRoute(
        adminRequest(`/api/admin/accounts/${targetId}/access/reset`, { method: "POST" }),
        { params: Promise.resolve({ id: targetId }) }
      );
      expect(signedOut.status).toBe(401);

      holder.userId = targetId;
      const nonOperator = await resetAccessRoute(
        adminRequest(`/api/admin/accounts/${targetId}/access/reset`, { method: "POST" }),
        { params: Promise.resolve({ id: targetId }) }
      );
      expect(nonOperator.status).toBe(404);
    } finally {
      holder.userId = previous;
    }
  });

  it("unlocks a locked account over HTTP and refuses a no-op unlock", async () => {
    const db = holder.db!;
    const email = "contract-unlock@platform.test";
    const lockedId = await seedUser(db, email, "Contract Unlock");
    await db.insert(accountAccessState).values({
      userId: lockedId,
      passwordSetAt: new Date(),
      failedAttempts: 3,
      lockedUntil: sql`now() + interval '10 minutes'`,
    });

    const response = await unlockAccessRoute(
      adminRequest(`/api/admin/accounts/${lockedId}/access/unlock`, { method: "POST" }),
      { params: Promise.resolve({ id: lockedId }) }
    );
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ unlocked: true, clearedAttempts: 3 });
    expect(await accessEventCount(db, lockedId, "account.unlocked")).toBe(1);

    const again = await unlockAccessRoute(
      adminRequest(`/api/admin/accounts/${lockedId}/access/unlock`, { method: "POST" }),
      { params: Promise.resolve({ id: lockedId }) }
    );
    expect(again.status).toBe(404);
    const payload = (await again.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("not_locked");
    expectCleanError(payload);
    expectNoStore(again);
    expect(await accessEventCount(db, lockedId, "account.unlocked")).toBe(1);
  });

  it("answers an unknown unlock with 404 and no internals", async () => {
    const response = await unlockAccessRoute(
      adminRequest("/api/admin/accounts/no-such-user/access/unlock", { method: "POST" }),
      { params: Promise.resolve({ id: "no-such-user" }) }
    );
    expect(response.status).toBe(404);
    expectCleanError(await response.json());
    expectNoStore(response);
  });

  it("marks every successful read no-store", async () => {
    const accounts = await getAccounts(adminRequest("/api/admin/accounts"));
    expect(accounts.status).toBe(200);
    expectNoStore(accounts);

    const events = await getEvents(adminRequest("/api/admin/events"));
    expect(events.status).toBe(200);
    expectNoStore(events);

    const detail = await getAccount(adminRequest(`/api/admin/accounts/${targetId}`), {
      params: Promise.resolve({ id: targetId }),
    });
    expect(detail.status).toBe(200);
    expectNoStore(detail);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { listAccounts, PlatformRepoError, suspendAccount } from "@/features/platform/repo";
import {
  adminAccountsQuerySchema,
  decodeAdminCursor,
  encodeAdminCursor,
} from "@/features/platform/schema";
import { ACCOUNT_STAGES, deriveAccountStage, stageIndex } from "@/features/platform/stage";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { getAccountDetail, listPlatformEvents } from "@/features/platform/repo";
import {
  order as orderTable,
  platformEvent as platformEventTable,
  restaurant as restaurantTable,
  session as sessionTable,
} from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * B2 — Reads: list, detail, stage (PGlite, no external services).
 *
 * The plan's list: stage derivation for every branch; counts match the
 * seeded rows; cursor pagination has no duplicates and no gaps; a
 * suspended account still appears with its status; a deleted café does
 * not break the list.
 */

describe("account stage derivation", () => {
  it("reads signed-up when every count is zero", () => {
    expect(
      deriveAccountStage({ cafeCount: 0, menuCount: 0, liveCount: 0, orderCount: 0 })
    ).toBe("signed_up");
  });

  it("reads cafe when only the café exists", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 0, liveCount: 0, orderCount: 0 })
    ).toBe("cafe");
  });

  it("reads menu when a draft exists but nothing is live", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 2, liveCount: 0, orderCount: 0 })
    ).toBe("menu");
  });

  it("reads published when a live pointer exists", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 2, liveCount: 1, orderCount: 0 })
    ).toBe("published");
  });

  it("reads ordering once a first order exists", () => {
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 2, liveCount: 1, orderCount: 3 })
    ).toBe("ordering");
  });

  it("prefers the furthest proven step when counts disagree", () => {
    // An order against a café whose menu was since deleted still proves
    // the account reached ordering — history is not unwound.
    expect(
      deriveAccountStage({ cafeCount: 1, menuCount: 0, liveCount: 0, orderCount: 1 })
    ).toBe("ordering");
    expect(
      deriveAccountStage({ cafeCount: 0, menuCount: 2, liveCount: 0, orderCount: 0 })
    ).toBe("menu");
  });

  it("rejects counts that cannot come from the query", () => {
    expect(() =>
      deriveAccountStage({ cafeCount: -1, menuCount: 0, liveCount: 0, orderCount: 0 })
    ).toThrow(RangeError);
    expect(() =>
      deriveAccountStage({ cafeCount: 0, menuCount: 1.5, liveCount: 0, orderCount: 0 })
    ).toThrow(RangeError);
  });

  it("orders the funnel signed-up first and ordering last", () => {
    expect(ACCOUNT_STAGES).toEqual(["signed_up", "cafe", "menu", "published", "ordering"]);
    expect(stageIndex("signed_up")).toBe(0);
    expect(stageIndex("ordering")).toBe(ACCOUNT_STAGES.length - 1);
  });
});

describe("admin read query contracts", () => {
  it("defaults an empty query to all/newest without a cursor", () => {
    expect(adminAccountsQuerySchema.parse({})).toEqual({
      filter: "all",
      sort: "newest",
    });
  });

  it("trims the search text and rejects unknown filters", () => {
    expect(adminAccountsQuerySchema.parse({ q: "  erin@cafe.test  " }).q).toBe(
      "erin@cafe.test"
    );
    expect(adminAccountsQuerySchema.safeParse({ filter: "everyone" }).success).toBe(false);
    expect(adminAccountsQuerySchema.safeParse({ sort: "oldest" }).success).toBe(false);
  });

  it("round-trips a cursor and refuses garbage", () => {
    const cursor = { key: "2026-11-26T00:00:00.000Z", id: "user_123" };
    expect(decodeAdminCursor(encodeAdminCursor(cursor))).toEqual(cursor);
    expect(decodeAdminCursor(undefined)).toBeNull();
    expect(decodeAdminCursor("not-a-cursor")).toBeNull();
    expect(decodeAdminCursor(encodeAdminCursor({ key: "", id: "" }))).toBeNull();
  });
});

describe("accounts list query", () => {
  let db: TestDb;
  let actorId: string;

  function menuDoc(id: string): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id });
  }

  beforeEach(async () => {
    ({ db } = await createTestDb());
    actorId = await seedUser(db, "list-actor@cafe.test", "Actor");
  }, 30_000);

  async function seedCafe(
    tag: string,
    options: { menu?: boolean; live?: boolean; orders?: Date[]; suspend?: boolean } = {}
  ): Promise<string> {
    const id = await seedUser(db, `list-${tag}@cafe.test`, `List ${tag}`);
    const cafe = await createRestaurant(db, id, `Caf\u00e9 ${tag}`);
    if (options.menu ?? options.live) {
      await createMenuForUser(db, id, cafe.id, menuDoc(`menu-${tag}`));
    }
    if (options.live) {
      await publishMenuForUser(db, id, `menu-${tag}`);
    }
    for (const at of options.orders ?? []) {
      await db
        .insert(orderTable)
        .values({ restaurantId: cafe.id, menuTitle: "Lunch", tableLabel: "3", createdAt: at });
    }
    if (options.suspend) {
      await suspendAccount(db, { targetUserId: id, reason: "abuse_or_spam", actorUserId: actorId });
    }
    return id;
  }

  it("returns counts, stage and suspension status for seeded accounts", async () => {
    const now = new Date();
    const ordered = await seedCafe("ordered", { menu: true, live: true, orders: [now] });
    const drafting = await seedCafe("drafting", { menu: true });
    const stopped = await seedCafe("stopped", { suspend: true });
    const bare = await seedUser(db, "list-bare@cafe.test", "List bare");

    const { accounts } = await listAccounts(db, {});
    const byId = new Map(accounts.map((row) => [row.id, row]));
    // The actor row exists too — every seeded account is listed.
    expect(accounts.length).toBe(5);

    expect(byId.get(ordered)).toMatchObject({
      cafeCount: 1,
      menuCount: 1,
      liveCount: 1,
      orders7: 1,
      suspended: false,
      stage: "ordering",
    });
    expect(byId.get(ordered)?.lastOrderAt).not.toBeNull();
    expect(byId.get(drafting)).toMatchObject({
      menuCount: 1,
      liveCount: 0,
      orders7: 0,
      lastOrderAt: null,
      suspended: false,
      stage: "menu",
    });
    expect(byId.get(stopped)).toMatchObject({ cafeCount: 1, suspended: true, stage: "cafe" });
    expect(byId.get(stopped)?.suspendedAt).not.toBeNull();
    expect(byId.get(bare)).toMatchObject({
      cafeCount: 0,
      menuCount: 0,
      suspended: false,
      stage: "signed_up",
    });
  });

  it("paginates 30 accounts without duplicates or gaps", async () => {
    for (let n = 0; n < 30; n += 1) {
      await seedUser(db, `list-page-${String(n).padStart(2, "0")}@cafe.test`, `Page ${n}`);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await listAccounts(db, cursor ? { cursor: decodeAdminCursor(cursor)! } : {});
      // Decode through the wire format, like the route does.
      const wire = result.nextCursor;
      seen.push(...result.accounts.map((row) => row.id));
      cursor = wire;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(2);
    // 30 seeded plus the actor row.
    expect(seen.length).toBe(31);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("searches by name or email, with wildcards escaped", async () => {
    await seedUser(db, "list-erin@cafe.test", "Erin Espresso");
    await seedUser(db, "list-percent@cafe.test", "100% Caf\u00e9");
    await seedUser(db, "list-unrelated@cafe.test", "Unrelated Owner");

    const byEmail = await listAccounts(db, { q: "erin@cafe" });
    expect(byEmail.accounts.map((row) => row.email)).toEqual(["list-erin@cafe.test"]);
    const byName = await listAccounts(db, { q: "espresso" });
    expect(byName.accounts.map((row) => row.email)).toEqual(["list-erin@cafe.test"]);
    // A bare % must match the literal name, not everything.
    const byPercent = await listAccounts(db, { q: "%" });
    expect(byPercent.accounts.map((row) => row.email)).toEqual(["list-percent@cafe.test"]);
  });

  it("filters by ordering, onboarding and suspension", async () => {
    const now = new Date();
    await seedCafe("filter-ordered", { menu: true, live: true, orders: [now] });
    await seedCafe("filter-draft", { menu: true });
    await seedCafe("filter-stopped", { suspend: true });
    await seedUser(db, "list-filter-bare@cafe.test", "Filter bare");

    const taking = await listAccounts(db, { filter: "taking_orders" });
    expect(taking.accounts.map((row) => row.email)).toEqual(["list-filter-ordered@cafe.test"]);
    const fresh = await listAccounts(db, { filter: "not_onboarded" });
    expect(fresh.accounts.map((row) => row.email).sort()).toEqual(
      ["list-actor@cafe.test", "list-filter-bare@cafe.test", "list-filter-draft@cafe.test", "list-filter-stopped@cafe.test"].sort()
    );
    const stopped = await listAccounts(db, { filter: "suspended" });
    expect(stopped.accounts.map((row) => row.email)).toEqual([
      "list-filter-stopped@cafe.test",
    ]);
  });

  it("sorts by recent activity and 7-day volume", async () => {
    const now = Date.now();
    await seedCafe("sort-busy", {
      menu: true,
      orders: [new Date(now - 3_600_000), new Date(now - 7_200_000), new Date(now)],
    });
    await seedCafe("sort-quiet", { menu: true, orders: [new Date(now - 1_800_000)] });
    await seedCafe("sort-old", { menu: true, orders: [new Date(now - 30 * 86_400_000)] });

    const byVolume = await listAccounts(db, { sort: "orders" });
    expect(byVolume.accounts.map((row) => row.email)).toEqual([
      "list-sort-busy@cafe.test",
      "list-sort-quiet@cafe.test",
      "list-sort-old@cafe.test",
      "list-actor@cafe.test",
    ]);
    const byActive = await listAccounts(db, { sort: "active" });
    const emails = byActive.accounts.map((row) => row.email);
    // Busiest ordered last (now); the 30-day-old account sorts below never-ordered.
    expect(emails[0]).toBe("list-sort-busy@cafe.test");
    expect(emails[emails.length - 2]).toBe("list-sort-old@cafe.test");
    expect(emails[emails.length - 1]).toBe("list-actor@cafe.test");
  });

  it("still lists an account whose caf\u00e9 was deleted", async () => {
    const id = await seedCafe("deleted", { menu: true });
    const cafes = await db.select({ id: restaurantTable.id }).from(restaurantTable);
    expect(cafes.length).toBe(1);
    await db.delete(restaurantTable);
    const { accounts } = await listAccounts(db, {});
    // Memberships, menus and orders cascade away with the caf\u00e9.
    expect(accounts.map((row) => row.id).sort()).toEqual([actorId, id].sort());
    expect(accounts.find((row) => row.id === id)).toMatchObject({
      cafeCount: 0,
      menuCount: 0,
      stage: "signed_up",
    });
  });

  it("rejects a cursor that is not a date", async () => {
    await expect(listAccounts(db, { cursor: { key: "not-a-date", id: "x" } })).rejects.toBeInstanceOf(
      PlatformRepoError
    );
    await expect(
      listAccounts(db, { sort: "orders", cursor: { key: "bogus", id: "x" } })
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });
});

describe("account detail", () => {
  let db: TestDb;
  let actorId: string;

  function menuDoc(id: string): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id });
  }

  beforeEach(async () => {
    ({ db } = await createTestDb());
    actorId = await seedUser(db, "detail-actor@cafe.test", "Actor");
  }, 30_000);

  async function seedFull(tag: string): Promise<string> {
    const id = await seedUser(db, `detail-${tag}@cafe.test`, `Detail ${tag}`);
    const cafe = await createRestaurant(db, id, `Caf\u00e9 ${tag}`);
    await createMenuForUser(db, id, cafe.id, menuDoc(`menu-${tag}`));
    await publishMenuForUser(db, id, `menu-${tag}`);
    await db
      .insert(orderTable)
      .values({ restaurantId: cafe.id, menuTitle: "Lunch", tableLabel: "3" });
    await db.insert(sessionTable).values({
      id: `session-${tag}`,
      userId: id,
      token: `token-${tag}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      userAgent: "TestBrowser/1.0",
    });
    return id;
  }

  it("returns membership-scoped data with no diner or network detail", async () => {
    const id = await seedFull("full");
    const detail = await getAccountDetail(db, id);

    expect(detail.account).toMatchObject({ id, email: "detail-full@cafe.test" });
    expect(detail.stage).toBe("ordering");
    expect(detail.suspension).toBeNull();
    expect(detail.cafes).toHaveLength(1);
    expect(detail.cafes[0]).toMatchObject({ name: "Caf\u00e9 full", role: "owner" });
    expect(detail.menus).toHaveLength(1);
    expect(detail.menus[0]).toMatchObject({ cafeId: detail.cafes[0]!.id, live: true });
    expect(detail.menus[0]?.slug).not.toBeNull();
    expect(detail.usage).toEqual({ requests: 0, cap: expect.any(Number), remaining: expect.any(Number) });
    expect(detail.orders.total).toBe(1);
    expect(detail.orders.last7).toBe(1);
    expect(detail.orders.lastOrderAt).not.toBeNull();
    expect(detail.orders.recent).toHaveLength(1);
    expect(detail.orders.recent[0]).toMatchObject({ tableLabel: "3" });
    // One session, device label only — the address column never leaves.
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]).toMatchObject({ id: "session-full", userAgent: "TestBrowser/1.0" });
    expect(detail.sessions[0]).not.toHaveProperty("ipAddress");
    // Timeline names the milestones, newest first.
    const kinds = detail.timeline.map((entry) => entry.kind);
    expect(kinds).toContain("account_created");
    expect(kinds).toContain("cafe_joined");
    const ats = detail.timeline.map((entry) => entry.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it("shows an open suspension with its reason, history intact", async () => {
    const id = await seedFull("stopped");
    await suspendAccount(db, { targetUserId: id, reason: "owner_request", actorUserId: actorId });

    const detail = await getAccountDetail(db, id);
    expect(detail.suspension).toMatchObject({ reason: "owner_request", suspendedBy: actorId });
    expect(detail.suspension?.suspendedAt).not.toBeNull();
    expect(detail.events.map((event) => event.action)).toContain("account.suspended");
    expect(detail.timeline.map((entry) => entry.kind)).toContain("suspended");
  });

  it("reads an account with nothing on it", async () => {
    const id = await seedUser(db, "detail-bare@cafe.test", "Detail bare");
    const detail = await getAccountDetail(db, id);
    expect(detail.stage).toBe("signed_up");
    expect(detail.cafes).toEqual([]);
    expect(detail.menus).toEqual([]);
    expect(detail.orders.total).toBe(0);
    expect(detail.sessions).toEqual([]);
    expect(detail.timeline.map((entry) => entry.kind)).toEqual(["account_created"]);
  });

  it("throws not_found for an unknown account", async () => {
    await expect(getAccountDetail(db, "no-such-user")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("operator log", () => {
  let db: TestDb;

  beforeEach(async () => {
    ({ db } = await createTestDb());
  }, 30_000);

  async function seedEvents(count: number): Promise<void> {
    const base = Date.now();
    for (let n = 0; n < count; n += 1) {
      await db.insert(platformEventTable).values({
        action: n % 2 === 0 ? "account.suspended" : "account.restored",
        actorUserId: null,
        actorEmail: "operator@cafe.test",
        targetUserId: null,
        targetEmail: `target-${n}@cafe.test`,
        detail: null,
        createdAt: new Date(base + n * 1000),
      });
    }
  }

  it("pages newest-first and filters by action", async () => {
    await seedEvents(27);
    const first = await listPlatformEvents(db, {});
    expect(first.events).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    // Newest first: the last seeded row leads.
    expect(first.events[0]?.targetEmail).toBe("target-26@cafe.test");

    const second = await listPlatformEvents(db, { cursor: decodeAdminCursor(first.nextCursor) });
    expect(second.events).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();
    const ids = [...first.events, ...second.events].map((event) => event.id);
    expect(new Set(ids).size).toBe(27);

    const suspended = await listPlatformEvents(db, { action: "account.suspended" });
    expect(suspended.events.length).toBe(14);
    expect(suspended.events.every((event) => event.action === "account.suspended")).toBe(true);
  });
});

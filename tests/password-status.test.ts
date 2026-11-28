import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { account } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * GET /api/account/password-status — the Settings password card's read.
 * A link-only account reports no password; a credential row with a hash
 * reports one (a hashless credential row still reads as none, matching
 * the set-password route, which treats it as a first set). Signed-out
 * callers get 401, never a state that is not theirs.
 */

const holder: { db: TestDb | null; userId: string | null } = { db: null, userId: null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

describe("GET /api/account/password-status", () => {
  let userId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    const { db } = await createTestDb();
    holder.db = db;
    userId = await seedUser(db, "status@cafe.test", "Status Owner");
    holder.userId = userId;
  }, 30_000);

  afterEach(() => {
    holder.db = null;
    holder.userId = null;
  });

  it("reports no password for a link-only account", async () => {
    const { GET } = await import("@/app/api/account/password-status/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ hasPassword: false });
  });

  it("reports a password once a credential hash exists", async () => {
    await holder.db!.insert(account).values({
      id: crypto.randomUUID(),
      userId,
      providerId: "credential",
      accountId: userId,
      password: "hashed-placeholder",
    });
    const { GET } = await import("@/app/api/account/password-status/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasPassword: true });
  });

  it("a hashless credential row still reads as no password", async () => {
    await holder.db!.insert(account).values({
      id: crypto.randomUUID(),
      userId,
      providerId: "credential",
      accountId: userId,
    });
    const { GET } = await import("@/app/api/account/password-status/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasPassword: false });
  });

  it("401s when signed out and 503s when the db is down", async () => {
    const { GET } = await import("@/app/api/account/password-status/route");
    holder.userId = null;
    const signedOut = await GET();
    expect(signedOut.status).toBe(401);

    holder.userId = userId;
    holder.db = null;
    const dbDown = await GET();
    expect(dbDown.status).toBe(503);
  });
});

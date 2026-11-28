import { eq, sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { account, user as userTable } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * Password nudge — one post-sign-in offer of a password for link-only
 * accounts older than 24 hours. Eligibility needs all three: old enough,
 * no password hash, never dismissed. The dismissal is per account, so the
 * banner shows at most once ever; setting a password ends it by itself.
 * The banner renders nothing until the eligibility read answers.
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

/**
 * Age stamped with the database clock, the way production rows are: a JS
 * Date in a plain `timestamp` lands hours off on a non-UTC machine, which
 * would test the machine's zone instead of the 24-hour rule.
 */
async function seedUserAtAge(db: TestDb, email: string, hours: number): Promise<string> {
  const { seedUser } = await import("./helpers/pg-test-db");
  const id = await seedUser(db, email, "Nudge Owner");
  await db
    .update(userTable)
    .set({ createdAt: sql`now() - ${`${hours} hours`}::interval` })
    .where(eq(userTable.id, id));
  return id;
}

async function seedPassword(db: TestDb, userId: string): Promise<void> {
  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId,
    providerId: "credential",
    accountId: userId,
    password: "hashed-placeholder",
  });
}

function sameOrigin(body: unknown, origin: string | null = null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "test.local",
  };
  if (origin) headers.origin = origin;
  return new Request("http://test.local/api/account/password-nudge", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("GET /api/account/password-nudge", () => {
  beforeEach(async () => {
    const { createTestDb } = await import("./helpers/pg-test-db");
    const { db } = await createTestDb();
    holder.db = db;
  }, 30_000);

  afterEach(() => {
    holder.db = null;
    holder.userId = null;
  });

  it("stays ineligible for an account younger than 24 hours", async () => {
    holder.userId = await seedUserAtAge(holder.db!, "young@cafe.test", 23);
    const { GET } = await import("@/app/api/account/password-nudge/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ eligible: false });
  });

  it("is eligible for an old link-only account", async () => {
    holder.userId = await seedUserAtAge(holder.db!, "old@cafe.test", 25);
    const { GET } = await import("@/app/api/account/password-nudge/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ eligible: true });
  });

  it("ends when a password is set, without any dismissal", async () => {
    const id = await seedUserAtAge(holder.db!, "set@cafe.test", 90 * 24);
    await seedPassword(holder.db!, id);
    holder.userId = id;
    const { GET } = await import("@/app/api/account/password-nudge/route");
    const response = await GET();
    expect(await response.json()).toEqual({ eligible: false });
  });

  it("never returns after dismissal, and dismissing is idempotent", async () => {
    holder.userId = await seedUserAtAge(holder.db!, "dismissed@cafe.test", 25);
    const routes = await import("@/app/api/account/password-nudge/route");

    const first = await routes.POST(sameOrigin({ dismissed: true }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ dismissed: true });

    const second = await routes.POST(sameOrigin({ dismissed: true }));
    expect(second.status).toBe(200);

    const check = await routes.GET();
    expect(await check.json()).toEqual({ eligible: false });
  });

  it("401s when signed out, rejects bad bodies and cross origins", async () => {
    const routes = await import("@/app/api/account/password-nudge/route");

    holder.userId = null;
    expect((await routes.GET()).status).toBe(401);
    expect((await routes.POST(sameOrigin({ dismissed: true }))).status).toBe(401);

    holder.userId = await seedUserAtAge(holder.db!, "evil@cafe.test", 25);
    expect((await routes.POST(sameOrigin({ dismissed: false }))).status).toBe(400);
    const crossOrigin = await routes.POST(sameOrigin({ dismissed: true }, "https://evil.example"));
    expect(crossOrigin.status).toBe(403);
    expect(holder.userId).not.toBeNull();
  });
});

describe("PasswordNudgeBanner", () => {
  it("renders nothing until eligibility answers", async () => {
    const { PasswordNudgeBanner } = await import("@/components/auth/password-nudge-banner");
    expect(renderToStaticMarkup(createElement(PasswordNudgeBanner))).toBe("");
  });
});

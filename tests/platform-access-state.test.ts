import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  deriveAccessChip,
  forcePasswordReset,
  getAccountAccessState,
  getAccountDetail,
  listAccounts,
  unlockAccount,
} from "@/features/platform/repo";
import {
  accountAccessState,
  platformEvent,
  session as sessionTable,
  type PlatformEventAction,
} from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * B4 — operator-visible sign-in state (PGlite, no external services).
 *
 * The Access card reads real state: a missing row is the link-only
 * cutover default, never an error. Forcing a reset requires a new
 * password, revokes sessions, and audits exactly once; unlocking
 * clears the counter and the lockout instant, audited exactly once,
 * and refuses a no-op instead of logging one. Nothing here selects a
 * hash or a token — the state table carries neither.
 */

let db: TestDb;
let operatorId: string;
const OPERATOR_EMAIL = "access-op@cafe.test";

beforeAll(async () => {
  ({ db } = await createTestDb());
  operatorId = await seedUser(db, OPERATOR_EMAIL, "Operator");
}, 30_000);

async function seedTarget(tag: string): Promise<{ id: string; email: string }> {
  const email = `access-target-${tag}@cafe.test`;
  const id = await seedUser(db, email, `Target ${tag}`);
  return { id, email };
}

async function eventCount(targetUserId: string, action: PlatformEventAction): Promise<number> {
  const rows = await db
    .select({ id: platformEvent.id })
    .from(platformEvent)
    .where(and(eq(platformEvent.targetUserId, targetUserId), eq(platformEvent.action, action)));
  return rows.length;
}

describe("access-state reads", () => {
  it("reads a missing row as the no-password cutover default", async () => {
    const target = await seedTarget("default");
    const state = await getAccountAccessState(db, target.id);
    expect(state).toMatchObject({
      passwordSetAt: null,
      resetRequired: false,
      resetSentAt: null,
      failedAttempts: 0,
      lockedUntil: null,
      locked: false,
    });
    expect(deriveAccessChip(state)).toBe("no_password");
  });

  it("reads an unknown account as not found", async () => {
    await expect(
      getAccountAccessState(db, "00000000-0000-0000-0000-000000000000")
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_found" });
  });

  it("derives the chip with lockout outranking reset outranking cutover", async () => {
    const lockedAt = new Date(Date.now() + 12 * 60_000).toISOString();
    expect(
      deriveAccessChip({
        passwordSetAt: new Date().toISOString(),
        resetRequired: true,
        resetSentAt: new Date().toISOString(),
        failedAttempts: 5,
        lockedUntil: lockedAt,
        locked: true,
        secondFactorEnrolled: false,
      })
    ).toBe("locked");
    expect(
      deriveAccessChip({
        passwordSetAt: new Date().toISOString(),
        resetRequired: true,
        resetSentAt: new Date().toISOString(),
        failedAttempts: 0,
        lockedUntil: null,
        locked: false,
        secondFactorEnrolled: false,
      })
    ).toBe("reset_required");
    expect(
      deriveAccessChip({
        passwordSetAt: new Date().toISOString(),
        resetRequired: false,
        resetSentAt: null,
        failedAttempts: 0,
        lockedUntil: null,
        locked: false,
        secondFactorEnrolled: false,
      })
    ).toBe("password_set");
  });

  it("stops reading an expired lockout as locked", async () => {
    const target = await seedTarget("expired");
    await db.insert(accountAccessState).values({
      userId: target.id,
      passwordSetAt: new Date(),
      failedAttempts: 5,
      lockedUntil: sql`now() - interval '1 minute'`,
    });
    const state = await getAccountAccessState(db, target.id);
    expect(state.locked).toBe(false);
    expect(state.failedAttempts).toBe(5);
    expect(deriveAccessChip(state)).toBe("password_set");
  });
});

describe("access state in list and detail", () => {
  it("chips every row and filters by sign-in state", async () => {
    const plain = await seedTarget("list-plain");
    const set = await seedTarget("list-set");
    await db.insert(accountAccessState).values({ userId: set.id, passwordSetAt: new Date() });
    const reset = await seedTarget("list-reset");
    await db.insert(accountAccessState).values({
      userId: reset.id,
      passwordSetAt: new Date(),
      resetRequired: true,
      resetSentAt: new Date(),
    });
    const locked = await seedTarget("list-locked");
    await db.insert(accountAccessState).values({
      userId: locked.id,
      passwordSetAt: new Date(),
      failedAttempts: 5,
      lockedUntil: sql`now() + interval '10 minutes'`,
    });

    const page = await listAccounts(db, { q: "access-target-list-" });
    expect(page.accounts).toHaveLength(4);
    const chips = new Map(page.accounts.map((account) => [account.id, account.accessChip]));
    expect(chips.get(plain.id)).toBe("no_password");
    expect(chips.get(set.id)).toBe("password_set");
    expect(chips.get(reset.id)).toBe("reset_required");
    expect(chips.get(locked.id)).toBe("locked");

    const onlyPlain = await listAccounts(db, {
      q: "access-target-list-",
      filter: "no_password",
    });
    expect(onlyPlain.accounts.map((account) => account.id)).toEqual([plain.id]);

    const onlyReset = await listAccounts(db, {
      q: "access-target-list-",
      filter: "reset_required",
    });
    expect(onlyReset.accounts.map((account) => account.id)).toEqual([reset.id]);

    const onlyLocked = await listAccounts(db, {
      q: "access-target-list-",
      filter: "locked",
    });
    expect(onlyLocked.accounts.map((account) => account.id)).toEqual([locked.id]);
  });

  it("carries the access block on the detail page with no password material", async () => {
    const target = await seedTarget("detail-access");
    await db.insert(accountAccessState).values({
      userId: target.id,
      passwordSetAt: new Date(),
      failedAttempts: 5,
      lockedUntil: sql`now() + interval '10 minutes'`,
    });

    const detail = await getAccountDetail(db, target.id);
    expect(detail.access).toMatchObject({
      resetRequired: false,
      failedAttempts: 5,
      locked: true,
      chip: "locked",
    });
    expect(detail.access.passwordSetAt).toEqual(expect.any(String));
    expect(detail.access.lockedUntil).toEqual(expect.any(String));
    // The block carries state only: no hash, no token, nothing to steal.
    expect(Object.keys(detail.access).sort()).toEqual([
      "chip",
      "failedAttempts",
      "locked",
      "lockedUntil",
      "passwordSetAt",
      "resetRequired",
      "resetSentAt",
      "secondFactorEnrolled",
    ]);
  });
});

describe("force password reset", () => {
  it("requires a new password, revokes sessions, and audits exactly once", async () => {
    const target = await seedTarget("reset");
    await db.insert(sessionTable).values([
      {
        id: "sess-reset-1",
        userId: target.id,
        token: "tok-reset-1",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      {
        id: "sess-reset-2",
        userId: target.id,
        token: "tok-reset-2",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ]);

    const result = await forcePasswordReset(db, {
      targetUserId: target.id,
      actorUserId: operatorId,
    });

    expect(result.sessionsRevoked).toBe(2);
    expect(
      (await db.select().from(sessionTable).where(eq(sessionTable.userId, target.id))).length
    ).toBe(0);

    const state = await getAccountAccessState(db, target.id);
    expect(state.resetRequired).toBe(true);
    expect(state.resetSentAt).toBe(result.resetSentAt);
    expect(deriveAccessChip(state)).toBe("reset_required");

    expect(await eventCount(target.id, "password.reset")).toBe(1);
    const events = await db
      .select({
        action: platformEvent.action,
        actorEmail: platformEvent.actorEmail,
        targetEmail: platformEvent.targetEmail,
        detail: platformEvent.detail,
      })
      .from(platformEvent)
      .where(eq(platformEvent.targetUserId, target.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "password.reset",
      actorEmail: OPERATOR_EMAIL,
      targetEmail: target.email,
    });
    // The detail says the email went out: the route sends it (P5).
    expect(events[0]!.detail).toContain("reset link emailed");
  });

  it("reports not found for an unknown account", async () => {
    await expect(
      forcePasswordReset(db, {
        targetUserId: "00000000-0000-0000-0000-000000000000",
        actorUserId: operatorId,
      })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_found" });
  });
});

describe("unlock sign-in", () => {
  it("clears the counter and the lockout, audited exactly once", async () => {
    const target = await seedTarget("unlock");
    await db.insert(accountAccessState).values({
      userId: target.id,
      passwordSetAt: new Date(),
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 12 * 60_000),
    });

    const result = await unlockAccount(db, {
      targetUserId: target.id,
      actorUserId: operatorId,
    });
    expect(result.clearedAttempts).toBe(5);

    const state = await getAccountAccessState(db, target.id);
    expect(state).toMatchObject({ failedAttempts: 0, lockedUntil: null, locked: false });
    expect(deriveAccessChip(state)).toBe("password_set");
    expect(await eventCount(target.id, "account.unlocked")).toBe(1);
  });

  it("refuses a no-op unlock instead of logging one", async () => {
    const pristine = await seedTarget("unlock-pristine");
    await expect(
      unlockAccount(db, { targetUserId: pristine.id, actorUserId: operatorId })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_locked" });
    expect(await eventCount(pristine.id, "account.unlocked")).toBe(0);

    const target = await seedTarget("unlock-twice");
    await db.insert(accountAccessState).values({
      userId: target.id,
      failedAttempts: 2,
      lockedUntil: null,
    });
    await unlockAccount(db, { targetUserId: target.id, actorUserId: operatorId });
    await expect(
      unlockAccount(db, { targetUserId: target.id, actorUserId: operatorId })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_locked" });
    expect(await eventCount(target.id, "account.unlocked")).toBe(1);
  });

  it("reports not found for an unknown account", async () => {
    await expect(
      unlockAccount(db, {
        targetUserId: "00000000-0000-0000-0000-000000000000",
        actorUserId: operatorId,
      })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_found" });
  });
});

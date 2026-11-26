import { and, eq, isNotNull, sql } from "drizzle-orm";

import { account, accountAccessState, user } from "@/lib/db/schema";

import type { PlatformDb } from "./platform-admin";

/**
 * Lockout counting (P4) — the password half of §9's shared 5-attempt /
 * 15-minute counter.
 *
 * The counter lives on `account_access_state`, the same row the operator
 * panel reads (B4) and the Unlock action clears, so the screen, the panel and
 * the auth gate can never disagree about the count. There is no second store
 * and no in-memory window: an expired `lockedUntil` stops reading as locked
 * without a sweep, and the P6 second-factor code paths will count against
 * this same pair of columns.
 *
 * Server-only: it names the auth tables, so it must never reach a client
 * bundle. The sign-in screen only ever renders the settled copy this module
 * produces, which arrives through the auth endpoint's error message.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: Date | null;
  /** `lockedUntil` is still in the future at the instant it was read. */
  locked: boolean;
  /** Whole minutes of pause left (ceil, at least 1 while locked). */
  minutesLeft: number;
}

const CLEARED: LockoutState = {
  failedAttempts: 0,
  lockedUntil: null,
  locked: false,
  minutesLeft: 0,
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The account's current counter; a missing row reads as clear.
 *
 * `locked` and the minutes left are computed by the database, against the
 * same `now()` the operator panel's reader uses: `locked_until` is a plain
 * `timestamp`, and mixing the database clock with a JavaScript one is how a
 * pause ends up reading as six hours long on a machine that is not in UTC.
 */
export async function readLockout(db: PlatformDb, userId: string): Promise<LockoutState> {
  const rows = await db
    .select({
      failedAttempts: accountAccessState.failedAttempts,
      lockedUntil: accountAccessState.lockedUntil,
      locked: sql<boolean>`coalesce(${accountAccessState.lockedUntil} > now(), false)`,
      minutesLeft: sql<number>`coalesce(greatest(1, ceil(extract(epoch from (${accountAccessState.lockedUntil} - now())) / 60)), 0)::int`,
    })
    .from(accountAccessState)
    .where(eq(accountAccessState.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ...CLEARED };
  return {
    failedAttempts: row.failedAttempts,
    lockedUntil: toDate(row.lockedUntil),
    locked: row.locked,
    minutesLeft: row.locked ? row.minutesLeft : 0,
  };
}

/**
 * The account behind a password sign-in attempt, or null when the address has
 * no account or no credential.
 *
 * Only accounts that can sign in with a password are counted: a link-only
 * account has no password door to attack, and writing a counter row for it
 * would turn a mistyped address into an account-shaped side effect.
 */
export async function findPasswordUserId(db: PlatformDb, email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(
      account,
      and(
        eq(account.userId, user.id),
        eq(account.providerId, "credential"),
        isNotNull(account.password)
      )
    )
    .where(eq(user.email, address))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Count one failed password attempt, locking when the window is spent.
 *
 * One statement counts (starting a fresh window when an earlier lock has
 * already expired), and a conditional UPDATE sets `lockedUntil` only while
 * the row is unlocked — so a burst of concurrent attempts can never *extend*
 * a lock, and an attempt that arrives during a lock changes nothing. The
 * counter is left at the cap so the panel can show "5 failed attempts".
 */
export async function recordFailedAttempt(db: PlatformDb, userId: string): Promise<LockoutState> {
  await db
    .insert(accountAccessState)
    .values({ userId, failedAttempts: 1 })
    .onConflictDoUpdate({
      target: accountAccessState.userId,
      set: {
        failedAttempts: sql`case when ${accountAccessState.lockedUntil} is not null and ${accountAccessState.lockedUntil} <= now() then 1 else ${accountAccessState.failedAttempts} + 1 end`,
        lockedUntil: sql`case when ${accountAccessState.lockedUntil} is not null and ${accountAccessState.lockedUntil} <= now() then null else ${accountAccessState.lockedUntil} end`,
      },
    });
  await db
    .update(accountAccessState)
    .set({
      lockedUntil: sql`now() + (${LOCKOUT_MINUTES} * interval '1 minute')`,
    })
    .where(
      and(
        eq(accountAccessState.userId, userId),
        sql`${accountAccessState.failedAttempts} >= ${MAX_FAILED_ATTEMPTS}`,
        sql`${accountAccessState.lockedUntil} is null`
      )
    );
  return readLockout(db, userId);
}

/**
 * A successful sign-in resets the window. Nothing is inserted here: an
 * account that never failed has no row to clear.
 */
export async function clearFailedAttempts(db: PlatformDb, userId: string): Promise<void> {
  await db
    .update(accountAccessState)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(accountAccessState.userId, userId));
}

/**
 * The settled pause copy (§9): says what happened, how long, and the one way
 * through that needs nobody — the emailed link, which is never gated by the
 * counter. It never names the address, so a screen holding it leaks nothing.
 *
 * Remaining attempts are deliberately not printed on a miss: a count that
 * only appears for accounts that can sign in with a password would tell an
 * unknown address apart from a known one, and §3's first principle outranks
 * the courtesy. The pause itself is what says how long, so the fifth attempt
 * still ends the guessing honestly.
 */
export function lockoutMessage(minutesLeft: number): string {
  const minutes = Math.max(1, minutesLeft);
  const unit = minutes === 1 ? "minute" : "minutes";
  return `Too many attempts. Sign-in for this account is paused for ${minutes} ${unit} — wait, or email yourself a sign-in link instead.`;
}

/** The address a `/sign-in/email` body names, lowercased like the library. */
export function signInEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const email = (body as { email?: unknown }).email;
  if (typeof email !== "string") return null;
  const address = email.trim().toLowerCase();
  return address ? address : null;
}

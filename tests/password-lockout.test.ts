import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { POST as setPasswordRoute } from "@/app/api/account/password/route";
import { getAccountAccessState, suspendAccount, unlockAccount } from "@/features/platform/repo";
import { getAuth } from "@/lib/auth";
import { takeDevSignInLink } from "@/lib/auth/dev-sign-in";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  lockoutMessage,
  readLockout,
} from "@/lib/auth/lockout";
import { accountAccessState, user } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

process.env.BETTER_AUTH_SECRET ??= "password-lockout-test-secret-64-chars-0123456789ab";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DEV_SIGN_IN_BYPASS ??= "1";

/**
 * P4 — lockout counting (PGlite + real Better Auth handlers, no external
 * services).
 *
 * §9's password half: five failures pause sign-in for 15 minutes on
 * `account_access_state`, the same row the operator panel reads and Unlock
 * clears; the pause is checked before the password is verified, a failed
 * attempt during it changes nothing, an expired pause stops reading as
 * locked, a success clears the window, and the emailed link stays open while
 * paused. The second-factor half of §9 lands with P6 and counts against these
 * same columns.
 */

const PASSWORD = "correct horse 9!";
const BASE_URL = "http://localhost:3000";

const holder: { db: TestDb | null; user: { id: string; email: string } | null } = {
  db: null,
  user: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => holder.user),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

let db: TestDb;
let operatorId: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  holder.db = db;
  operatorId = await seedUser(db, "p4-operator@cafe.test", "P4 Operator");
}, 30_000);

function signInRequest(body: unknown): Request {
  return new Request(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, host: "localhost:3000" },
    body: JSON.stringify(body),
  });
}

async function attemptSignIn(email: string, password: string) {
  const response = await getAuth().handler(signInRequest({ email, password }));
  let payload: { code?: string; message?: string } | null = null;
  try {
    payload = (await response.json()) as { code?: string; message?: string };
  } catch {
    payload = null;
  }
  return { response, payload, cookies: response.headers.getSetCookie() };
}

function sessionCookies(cookies: string[]): string[] {
  return cookies.filter((cookie) => cookie.toLowerCase().includes("session"));
}

function passwordRequest(body: unknown, cookie: string): Request {
  // `host` is what the same-origin guard compares the declared Origin against.
  return new Request(`${BASE_URL}/api/account/password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE_URL,
      host: "localhost:3000",
      cookie,
    },
    body: JSON.stringify(body),
  });
}

/** Mint a real session through the link flow (dev bypass parks the link). */
async function signInCookie(email: string): Promise<string> {
  const auth = getAuth();
  const request = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email, callbackURL: "/" }),
    })
  );
  expect(request.status).toBe(200);
  const parked = takeDevSignInLink(email);
  expect(parked).not.toBeNull();
  const token = new URL(parked as string).searchParams.get("token");
  const verify = await auth.handler(
    new Request(`${BASE_URL}/api/auth/magic-link/verify?token=${token}&callbackURL=/`)
  );
  const cookies = verify.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  expect(cookies).toContain("better-auth.session_token");
  return cookies;
}

/** Seed an account with a credential, through the real P2 route. */
async function seedPasswordAccount(
  email: string,
  name: string
): Promise<{ id: string; cookie: string }> {
  const id = await seedUser(db, email, name);
  holder.user = { id, email };
  const cookie = await signInCookie(email);
  const set = await setPasswordRoute(
    passwordRequest({ password: PASSWORD, confirm: PASSWORD }, cookie)
  );
  expect(set.status).toBe(200);
  holder.user = null;
  return { id, cookie };
}

async function accessRow(userId: string) {
  const rows = await db
    .select({
      failedAttempts: accountAccessState.failedAttempts,
      lockedUntil: accountAccessState.lockedUntil,
    })
    .from(accountAccessState)
    .where(eq(accountAccessState.userId, userId));
  return rows[0] ?? null;
}

/** Five wrong passwords: the fifth answers the pause. */
async function lockOut(email: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt += 1) {
    const { response } = await attemptSignIn(email, "not the password");
    expect(response.status).toBe(attempt === MAX_FAILED_ATTEMPTS ? 429 : 401);
  }
}

describe("lockout copy and expiry", () => {
  it("states the pause and the way through, in whole minutes", () => {
    expect(lockoutMessage(LOCKOUT_MINUTES)).toBe(
      "Too many attempts. Sign-in for this account is paused for 15 minutes — wait, or email yourself a sign-in link instead."
    );
    expect(lockoutMessage(1)).toContain("paused for 1 minute —");
  });

  it("stops reading an expired pause as locked", async () => {
    const id = await seedUser(db, "p4-expiry-read@cafe.test", "P4 Expiry Read");
    await db.insert(accountAccessState).values({
      userId: id,
      failedAttempts: MAX_FAILED_ATTEMPTS,
      lockedUntil: sql`now() - interval '1 minute'`,
    });
    expect(await readLockout(db, id)).toMatchObject({
      failedAttempts: MAX_FAILED_ATTEMPTS,
      locked: false,
      minutesLeft: 0,
    });

    await db
      .update(accountAccessState)
      .set({ lockedUntil: sql`now() + interval '10 minutes'` })
      .where(eq(accountAccessState.userId, id));
    const live = await readLockout(db, id);
    expect(live.locked).toBe(true);
    expect(live.minutesLeft).toBeGreaterThanOrEqual(9);
    expect(live.minutesLeft).toBeLessThanOrEqual(10);
  });
});

describe("password sign-in lockout", () => {
  it("counts failures, pauses on the fifth, and answers it as the pause", async () => {
    const email = "p4-counted@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Counted");

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const { response, payload } = await attemptSignIn(email, "not the password");
      expect(response.status).toBe(401);
      expect(payload?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
      // The miss itself stays the one settled sentence: no count, no lock.
      expect(payload?.message).toBe("Invalid email or password");
    }
    expect((await accessRow(id))?.failedAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);
    expect((await accessRow(id))?.lockedUntil).toBeNull();

    const fifth = await attemptSignIn(email, "not the password");
    expect(fifth.response.status).toBe(429);
    expect(fifth.payload?.code).toBe("ACCOUNT_LOCKED");
    expect(fifth.payload?.message).toBe(lockoutMessage(LOCKOUT_MINUTES));
    expect(sessionCookies(fifth.cookies)).toHaveLength(0);

    const row = await accessRow(id);
    expect(row?.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    const state = await readLockout(db, id);
    expect(state.locked).toBe(true);
    expect(state.minutesLeft).toBe(LOCKOUT_MINUTES);

    // The operator panel reads the same pause, with no new plumbing.
    const panel = await getAccountAccessState(db, id);
    expect(panel.locked).toBe(true);
    expect(panel.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
  });

  it("refuses the right password while paused and never extends the pause", async () => {
    const email = "p4-refused@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Refused");
    await lockOut(email);
    const lockedUntil = (await accessRow(id))?.lockedUntil as Date;

    const right = await attemptSignIn(email, PASSWORD);
    expect(right.response.status).toBe(429);
    expect(right.payload?.message).toContain("paused");
    expect(sessionCookies(right.cookies)).toHaveLength(0);

    const wrong = await attemptSignIn(email, "still not the password");
    expect(wrong.response.status).toBe(429);
    expect(sessionCookies(wrong.cookies)).toHaveLength(0);

    const row = await accessRow(id);
    expect(row?.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect((row?.lockedUntil as Date).getTime()).toBe(lockedUntil.getTime());
  });

  it("clears a partial counter on a successful sign-in", async () => {
    const email = "p4-clears@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Clears");
    await attemptSignIn(email, "not the password");
    await attemptSignIn(email, "not the password");
    expect((await accessRow(id))?.failedAttempts).toBe(2);

    const right = await attemptSignIn(email, PASSWORD);
    expect(right.response.status).toBe(200);
    expect(sessionCookies(right.cookies).length).toBeGreaterThan(0);

    const row = await accessRow(id);
    expect(row?.failedAttempts).toBe(0);
    expect(row?.lockedUntil).toBeNull();
  });

  it("stops pausing once the window expires, and starts a fresh one", async () => {
    const email = "p4-expired@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Expired");
    await db
      .update(accountAccessState)
      .set({
        failedAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil: sql`now() - interval '1 minute'`,
      })
      .where(eq(accountAccessState.userId, id));

    expect((await readLockout(db, id)).locked).toBe(false);

    const right = await attemptSignIn(email, PASSWORD);
    expect(right.response.status).toBe(200);

    // A failure after expiry counts as the first of a new window, not the sixth.
    await db
      .update(accountAccessState)
      .set({
        failedAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil: sql`now() - interval '1 minute'`,
      })
      .where(eq(accountAccessState.userId, id));
    const wrong = await attemptSignIn(email, "not the password");
    expect(wrong.response.status).toBe(401);
    expect((await accessRow(id))?.failedAttempts).toBe(1);
    expect((await accessRow(id))?.lockedUntil).toBeNull();
  });

  it("is cleared by the operator's Unlock, which is the same row", async () => {
    const email = "p4-unlocked@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Unlocked");
    await lockOut(email);
    expect((await accessRow(id))?.lockedUntil).not.toBeNull();

    const unlocked = await unlockAccount(db, { targetUserId: id, actorUserId: operatorId });
    expect(unlocked.clearedAttempts).toBe(MAX_FAILED_ATTEMPTS);

    const right = await attemptSignIn(email, PASSWORD);
    expect(right.response.status).toBe(200);
    expect(sessionCookies(right.cookies).length).toBeGreaterThan(0);
  });

  it("leaves the emailed link open while paused", async () => {
    const email = "p4-link@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Link");
    await lockOut(email);

    const parked = async () => {
      await getAuth().handler(
        new Request(`${BASE_URL}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL },
          body: JSON.stringify({ email, callbackURL: "/" }),
        })
      );
      return takeDevSignInLink(email) as string;
    };
    const token = new URL(await parked()).searchParams.get("token");
    const verify = await getAuth().handler(
      new Request(`${BASE_URL}/api/auth/magic-link/verify?token=${token}&callbackURL=/`)
    );
    const cookies = verify.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
    expect(cookies.join("; ")).toContain("better-auth.session_token");
    // The link signs in but does not unlock the password door: only a
    // success there (or an operator) clears the counter.
    expect((await accessRow(id))?.lockedUntil).not.toBeNull();
  });

  it("never writes a counter for an unknown address or a link-only account", async () => {
    const linkOnlyEmail = "p4-linkonly@cafe.test";
    const linkOnlyId = await seedUser(db, linkOnlyEmail, "P4 Link Only");

    for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt += 1) {
      const unknown = await attemptSignIn("p4-nobody@cafe.test", PASSWORD);
      expect(unknown.response.status).toBe(401);
      const noPassword = await attemptSignIn(linkOnlyEmail, PASSWORD);
      expect(noPassword.response.status).toBe(401);
    }

    expect(await accessRow(linkOnlyId)).toBeNull();
    const unknownRows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "p4-nobody@cafe.test"));
    expect(unknownRows).toHaveLength(0);
  });

  it("does not count a suspended account's refusal as a failed attempt", async () => {
    const email = "p4-suspended@cafe.test";
    const { id } = await seedPasswordAccount(email, "P4 Suspended");
    await suspendAccount(db, {
      targetUserId: id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });

    const gated = await attemptSignIn(email, PASSWORD);
    expect(gated.response.status).toBe(403);
    expect(sessionCookies(gated.cookies)).toHaveLength(0);

    const row = await accessRow(id);
    expect(row?.failedAttempts).toBe(0);
    expect(row?.lockedUntil).toBeNull();
  });
});

import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { POST as setPasswordRoute } from "@/app/api/account/password/route";
import { getAccountAccessState, resetTwoFactor } from "@/features/platform/repo";
import { isTwoFactorEnrolled } from "@/lib/auth/account-state";
import { getAuth } from "@/lib/auth";
import { takeDevSignInLink } from "@/lib/auth/dev-sign-in";
import { lockoutMessage } from "@/lib/auth/lockout";
import {
  accountAccessState,
  platformEvent,
  session as sessionTable,
  twoFactor,
} from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

process.env.BETTER_AUTH_SECRET ??= "password-two-factor-test-secret-64-chars-0123456789";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DEV_SIGN_IN_BYPASS ??= "1";

/**
 * P6 — operator second factor (PGlite + real Better Auth handlers).
 *
 * §11's half of the password plan: TOTP enrolment with ten encrypted
 * single-use recovery codes, the password-then-code challenge, and the
 * shared §9 counter — wrong codes count while unlocked, a recovery code
 * works while locked and clears the pause, wrong codes while locked
 * change nothing. The B5 reset kills the codes, revokes the sessions,
 * forces re-enrolment, and audits exactly once.
 *
 * TOTP codes are generated in-test (RFC 6238, SHA-1, 30 s, 6 digits)
 * from the secret the enable endpoint returns, so no authenticator app
 * or external service is involved.
 */

const PASSWORD = "correct horse 9!";
const BASE_URL = "http://localhost:3000";
const HOST_HEADERS = {
  "content-type": "application/json",
  origin: BASE_URL,
  host: "localhost:3000",
};

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
  operatorId = await seedUser(db, "p6-operator@cafe.test", "P6 Operator");
}, 30_000);

function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Current TOTP code for a secret (same parameters the plugin verifies). */
function totpCode(secret: string, time: number = Date.now()): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    1_000_000;
  return String(code).padStart(6, "0");
}

function authed(path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { ...HOST_HEADERS };
  if (cookie) headers.cookie = cookie;
  return new Request(`${BASE_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Mint a real session through the link flow (dev bypass parks the link). */
async function linkSessionCookie(email: string): Promise<string> {
  const auth = getAuth();
  const request = await auth.handler(
    authed("/api/auth/sign-in/magic-link", { email, callbackURL: "/" })
  );
  expect(request.status).toBe(200);
  const parked = takeDevSignInLink(email);
  expect(parked).not.toBeNull();
  const token = new URL(parked as string).searchParams.get("token");
  const verify = await auth.handler(
    new Request(`${BASE_URL}/api/auth/magic-link/verify?token=${token}&callbackURL=/`)
  );
  const cookies = cookiesOf(verify);
  expect(cookies).toContain("better-auth.session_token");
  return cookies;
}

/** Seed an account with a credential, through the real P2 route. */
async function seedPasswordAccount(email: string, name: string): Promise<string> {
  const id = await seedUser(db, email, name);
  holder.user = { id, email };
  const cookie = await linkSessionCookie(email);
  const set = await setPasswordRoute(
    new Request(`${BASE_URL}/api/account/password`, {
      method: "POST",
      headers: { ...HOST_HEADERS, cookie },
      body: JSON.stringify({ password: PASSWORD, confirm: PASSWORD }),
    })
  );
  expect(set.status).toBe(200);
  holder.user = null;
  return id;
}

async function signInAttempt(email: string, password: string) {
  const response = await getAuth().handler(authed("/api/auth/sign-in/email", { email, password }));
  return { status: response.status, cookies: cookiesOf(response), body: await jsonBody(response) };
}

async function enrolOperator(
  email: string,
  name: string
): Promise<{ id: string; secret: string; backupCodes: string[] }> {
  const id = await seedPasswordAccount(email, name);
  const session = await signInAttempt(email, PASSWORD);
  expect(session.status).toBe(200);
  const enable = await getAuth().handler(
    authed("/api/auth/two-factor/enable", { password: PASSWORD }, session.cookies)
  );
  expect(enable.status).toBe(200);
  const enabled = await jsonBody(enable);
  const secret = new URL(enabled.totpURI as string).searchParams.get("secret") as string;
  const backupCodes = enabled.backupCodes as string[];
  expect(secret.length).toBeGreaterThan(10);
  expect(backupCodes).toHaveLength(10);

  const verify = await getAuth().handler(
    authed("/api/auth/two-factor/verify-totp", { code: totpCode(secret) }, session.cookies)
  );
  expect(verify.status).toBe(200);
  expect(await isTwoFactorEnrolled(db, id)).toBe(true);
  return { id, secret, backupCodes };
}

/** A fresh challenge: the password is right, the code is still pending. */
async function challengeFor(email: string, password: string = PASSWORD): Promise<string> {
  const attempt = await signInAttempt(email, password);
  expect(attempt.status).toBe(200);
  expect(attempt.body.twoFactorRedirect).toBe(true);
  return attempt.cookies;
}

async function verifyTotp(challengeCookies: string, code: string) {
  const response = await getAuth().handler(
    authed("/api/auth/two-factor/verify-totp", { code }, challengeCookies)
  );
  return { status: response.status, body: await jsonBody(response), cookies: cookiesOf(response) };
}

async function verifyBackup(challengeCookies: string, code: string) {
  const response = await getAuth().handler(
    authed("/api/auth/two-factor/verify-backup-code", { code }, challengeCookies)
  );
  return { status: response.status, body: await jsonBody(response), cookies: cookiesOf(response) };
}

async function sessionsFor(userId: string): Promise<number> {
  return (
    await db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.userId, userId))
  ).length;
}

async function lockedRow(
  userId: string
): Promise<{ failedAttempts: number; lockedUntil: Date | null }> {
  const rows = await db
    .select({
      failedAttempts: accountAccessState.failedAttempts,
      lockedUntil: accountAccessState.lockedUntil,
    })
    .from(accountAccessState)
    .where(eq(accountAccessState.userId, userId));
  return {
    failedAttempts: rows[0]?.failedAttempts ?? 0,
    lockedUntil: rows[0]?.lockedUntil ?? null,
  };
}

describe("enrolment", () => {
  it("enrols with a TOTP code: ten encrypted codes, flag on, panel sees it", async () => {
    const { id, backupCodes } = await enrolOperator("p6-enrol@cafe.test", "P6 Enrol");
    expect(new Set(backupCodes).size).toBe(10);

    const rows = await db.select().from(twoFactor).where(eq(twoFactor.userId, id));
    expect(rows).toHaveLength(1);
    for (const code of backupCodes) {
      expect(rows[0]!.backupCodes).not.toContain(code);
    }

    const state = await getAccountAccessState(db, id);
    expect(state.twoFactorEnrolled).toBe(true);
  });

  it("challenges an enrolled operator and waves through one without a factor", async () => {
    const plainEmail = "p6-plain@cafe.test";
    const plainId = await seedPasswordAccount(plainEmail, "P6 Plain");
    expect(await isTwoFactorEnrolled(db, plainId)).toBe(false);

    const plain = await signInAttempt(plainEmail, PASSWORD);
    expect(plain.status).toBe(200);
    expect(plain.body.twoFactorRedirect).toBeUndefined();

    await enrolOperator("p6-gate@cafe.test", "P6 Gate");
    const challenged = await signInAttempt("p6-gate@cafe.test", PASSWORD);
    expect(challenged.status).toBe(200);
    expect(challenged.body.twoFactorRedirect).toBe(true);
    expect(challenged.body.twoFactorMethods).toContain("totp");
  });
});

describe("shared lockout counting", () => {
  it("counts wrong TOTP codes and pauses on the fifth", async () => {
    const email = "p6-counted@cafe.test";
    const { id } = await enrolOperator(email, "P6 Counted");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await verifyTotp(await challengeFor(email), "000000");
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe("INVALID_CODE");
    }
    const fifth = await verifyTotp(await challengeFor(email), "000000");
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe("ACCOUNT_LOCKED");
    expect(fifth.body.message).toBe(lockoutMessage(15));

    const state = await getAccountAccessState(db, id);
    expect(state.locked).toBe(true);
    expect(state.failedAttempts).toBe(5);
  });

  it("refuses a correct TOTP while paused and never extends the pause", async () => {
    const email = "p6-refused@cafe.test";
    const { id, secret } = await enrolOperator(email, "P6 Refused");
    const earlyChallenge = await challengeFor(email);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await verifyTotp(await challengeFor(email), "000000");
    }
    expect((await getAccountAccessState(db, id)).locked).toBe(true);
    const before = await lockedRow(id);

    const right = await verifyTotp(earlyChallenge, totpCode(secret));
    expect(right.status).toBe(429);
    expect(right.body.code).toBe("ACCOUNT_LOCKED");

    const wrong = await verifyTotp(earlyChallenge, "000000");
    expect(wrong.status).toBe(429);
    const after = await lockedRow(id);
    expect(after.failedAttempts).toBe(before.failedAttempts);
    expect((after.lockedUntil as Date).getTime()).toBe((before.lockedUntil as Date).getTime());
  });

  it("clears a partial counter on a correct code", async () => {
    const email = "p6-clears@cafe.test";
    const { id, secret } = await enrolOperator(email, "P6 Clears");
    await verifyTotp(await challengeFor(email), "000000");
    await verifyTotp(await challengeFor(email), "000000");
    expect((await lockedRow(id)).failedAttempts).toBe(2);

    const right = await verifyTotp(await challengeFor(email), totpCode(secret));
    expect(right.status).toBe(200);
    expect(right.cookies).toContain("better-auth.session_token");
    expect((await lockedRow(id)).failedAttempts).toBe(0);
  });
});

describe("recovery codes", () => {
  it("are single use: the second spend fails", async () => {
    const email = "p6-single@cafe.test";
    const { backupCodes } = await enrolOperator(email, "P6 Single");
    const first = await verifyBackup(await challengeFor(email), backupCodes[0] as string);
    expect(first.status).toBe(200);

    const reuse = await verifyBackup(await challengeFor(email), backupCodes[0] as string);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe("INVALID_BACKUP_CODE");
  });

  it("work while locked and clear the pause", async () => {
    const email = "p6-escape@cafe.test";
    const { id, backupCodes } = await enrolOperator(email, "P6 Escape");
    const escapeChallenge = await challengeFor(email);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await verifyTotp(await challengeFor(email), "000000");
    }
    expect((await getAccountAccessState(db, id)).locked).toBe(true);

    const escape = await verifyBackup(escapeChallenge, backupCodes[1] as string);
    expect(escape.status).toBe(200);
    expect(escape.cookies).toContain("better-auth.session_token");
    const state = await getAccountAccessState(db, id);
    expect(state.locked).toBe(false);
    expect(state.failedAttempts).toBe(0);
  });

  it("do not extend the pause when they are wrong while locked", async () => {
    const email = "p6-noextend@cafe.test";
    const { id } = await enrolOperator(email, "P6 Noextend");
    const earlyChallenge = await challengeFor(email);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await verifyTotp(await challengeFor(email), "000000");
    }
    const before = await lockedRow(id);
    expect(before.failedAttempts).toBe(5);

    const wrong = await verifyBackup(earlyChallenge, "nope-nope-nope");
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("INVALID_BACKUP_CODE");
    const after = await lockedRow(id);
    expect(after.failedAttempts).toBe(before.failedAttempts);
  });
});

describe("second factor reset", () => {
  it("kills the codes, revokes the sessions, forces re-enrolment, audits once", async () => {
    const email = "p6-reset@cafe.test";
    const { id, backupCodes } = await enrolOperator(email, "P6 Reset");
    expect(await sessionsFor(id)).toBeGreaterThan(0);

    const result = await resetTwoFactor(db, { targetUserId: id, actorUserId: operatorId });
    expect(result.sessionsRevoked).toBeGreaterThan(0);
    expect(await sessionsFor(id)).toBe(0);
    expect(await isTwoFactorEnrolled(db, id)).toBe(false);
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, id))).toHaveLength(0);
    expect((await getAccountAccessState(db, id)).twoFactorEnrolled).toBe(false);

    const events = await db
      .select({ action: platformEvent.action, detail: platformEvent.detail })
      .from(platformEvent)
      .where(eq(platformEvent.targetUserId, id));
    expect(events.filter((entry) => entry.action === "two_factor.reset")).toHaveLength(1);

    // The password door is whole again, with no challenge in the way.
    const plain = await signInAttempt(email, PASSWORD);
    expect(plain.status).toBe(200);
    expect(plain.body.twoFactorRedirect).toBeUndefined();

    // The old codes died with the row: nothing verifies against them.
    const rows = await db.select().from(twoFactor).where(eq(twoFactor.userId, id));
    expect(rows).toHaveLength(0);
    void backupCodes;
  });

  it("reports not_enrolled and not_found instead of logging a no-op", async () => {
    const id = await seedPasswordAccount("p6-never@cafe.test", "P6 Never");
    await expect(
      resetTwoFactor(db, { targetUserId: id, actorUserId: operatorId })
    ).rejects.toMatchObject({
      name: "PlatformRepoError",
      code: "not_enrolled",
    });
    await expect(
      resetTwoFactor(db, {
        targetUserId: "00000000-0000-0000-0000-000000000000",
        actorUserId: operatorId,
      })
    ).rejects.toMatchObject({ name: "PlatformRepoError", code: "not_found" });
  });

  it("keeps a suspended refusal out of the counter", async () => {
    const email = "p6-suspended@cafe.test";
    const { id } = await enrolOperator(email, "P6 Suspended");
    const { suspendAccount } = await import("@/features/platform/repo");
    await suspendAccount(db, {
      targetUserId: id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    const gated = await signInAttempt(email, PASSWORD);
    expect(gated.status).toBe(403);
    expect((await lockedRow(id)).failedAttempts).toBe(0);
  });
});

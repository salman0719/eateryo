import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { POST as setPasswordRoute } from "@/app/api/account/password/route";
import { POST as forgotRoute } from "@/app/api/password/forgot/route";
import { INVALID_RESET_TOKEN_COPY, POST as resetRoute } from "@/app/api/password/reset/route";
import { getAccountAccessState, suspendAccount } from "@/features/platform/repo";
import { getAuth } from "@/lib/auth";
import { takeDevSignInLink } from "@/lib/auth/dev-sign-in";
import {
  consumePasswordResetToken,
  hashResetToken,
  mintPasswordResetToken,
} from "@/lib/auth/reset-tokens";
import { passwordResetToken, session } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

process.env.BETTER_AUTH_SECRET ??= "password-reset-test-secret-64-chars-0123456789ab";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DEV_SIGN_IN_BYPASS ??= "1";

/**
 * P5 — reset emails + recovery (PGlite + real route handlers, no Resend).
 *
 * §10's half of the password work: hash-only 30-minute single-use tokens,
 * a forgot door that never oracles which addresses exist, a reset door
 * that burns exactly one token and revokes every session, and the settled
 * copies for a dead link. Forced-reset delivery (the operator door
 * sending the same link) lands with the admin wiring, not here.
 */

const PASSWORD = "correct horse 9!";
const NEW_PASSWORD = "a brand new horse 10?";
const BASE_URL = "http://localhost:3000";

const holder: { db: TestDb | null; user: { id: string; email: string } | null } = {
  db: null,
  user: null,
};

const sentLinks: Array<{ email: string; url: string }> = [];

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => holder.user),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

vi.mock("@/lib/auth/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/email")>();
  return {
    ...actual,
    sendPasswordResetEmail: vi.fn(async ({ email, url }: { email: string; url: string }) => {
      sentLinks.push({ email, url });
    }),
  };
});

let db: TestDb;
let operatorId: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  holder.db = db;
  operatorId = await seedUser(db, "p5-operator@cafe.test", "P5 Operator");
}, 30_000);

function authedRequest(path: string, body: unknown, forwardedFor?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: BASE_URL,
    host: "localhost:3000",
  };
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  return new Request(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get("token") ?? "";
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
async function seedPasswordAccount(email: string, name: string): Promise<string> {
  const id = await seedUser(db, email, name);
  holder.user = { id, email };
  const cookie = await signInCookie(email);
  const set = await setPasswordRoute(
    new Request(`${BASE_URL}/api/account/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        host: "localhost:3000",
        cookie,
      },
      body: JSON.stringify({ password: PASSWORD, confirm: PASSWORD }),
    })
  );
  expect(set.status).toBe(200);
  holder.user = null;
  return id;
}

async function attemptSignIn(email: string, password: string) {
  const response = await getAuth().handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, host: "localhost:3000" },
      body: JSON.stringify({ email, password }),
    })
  );
  return response;
}

function expectCleanError(payload: unknown): void {
  const text = JSON.stringify(payload);
  expect(text).not.toMatch(/stack|at .*:\d+:\d+|\bSQL\b|select .* from/i);
}

describe("reset token storage", () => {
  it("stores the hash only, burns on first use, and dies after 30 minutes", async () => {
    const id = await seedUser(db, "p5-token@cafe.test", "P5 Token");
    const minted = await mintPasswordResetToken(db, id);
    expect(minted.token.length).toBeGreaterThan(20);
    // The TTL is stamped by the database clock (plain `timestamp` reads
    // hours off as a JS Date on a non-UTC machine), so assert the window
    // in the database, not against `Date.now()`.
    const window = await db.execute(
      sql`select ${passwordResetToken.expiresAt} > now() + interval '20 minutes' as live, ${passwordResetToken.expiresAt} < now() + interval '40 minutes' as bounded from ${passwordResetToken} where ${passwordResetToken.userId} = ${id}`
    );
    expect(window.rows[0]).toMatchObject({ live: true, bounded: true });

    const rows = await db
      .select()
      .from(passwordResetToken)
      .where(eq(passwordResetToken.userId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashResetToken(minted.token));
    expect(rows[0].tokenHash).not.toContain(minted.token.slice(0, 8));
    expect(rows[0].usedAt).toBeNull();

    expect(await consumePasswordResetToken(db, minted.token)).toMatchObject({ userId: id });
    expect(await consumePasswordResetToken(db, minted.token)).toBeNull();
    expect(await consumePasswordResetToken(db, "no-such-token")).toBeNull();
  });

  it("reads an expired token as invalid", async () => {
    const id = await seedUser(db, "p5-expired@cafe.test", "P5 Expired");
    const minted = await mintPasswordResetToken(db, id);
    await db
      .update(passwordResetToken)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(passwordResetToken.userId, id));
    expect(await consumePasswordResetToken(db, minted.token)).toBeNull();
  });
});

describe("forgot-password request", () => {
  it("answers every address with the same 200 and emails only password accounts", async () => {
    const email = "p5-forgot@cafe.test";
    await seedPasswordAccount(email, "P5 Forgot");
    const linkOnlyEmail = "p5-linkonly@cafe.test";
    await seedUser(db, linkOnlyEmail, "P5 Link Only");
    sentLinks.length = 0;

    for (const address of [email, linkOnlyEmail, "p5-nobody@cafe.test"]) {
      const response = await forgotRoute(authedRequest("/api/password/forgot", { email: address }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ requested: true });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }

    expect(sentLinks).toHaveLength(1);
    expect(sentLinks[0].email).toBe(email);
    expect(sentLinks[0].url).toContain("/sign-in/reset?token=");
    expect(tokenFromUrl(sentLinks[0].url).length).toBeGreaterThan(20);
  });

  it("refuses cross-origin posts and malformed bodies", async () => {
    const crossOrigin = await forgotRoute(
      new Request(`${BASE_URL}/api/password/forgot`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.test" },
        body: JSON.stringify({ email: "p5-forgot@cafe.test" }),
      })
    );
    expect(crossOrigin.status).toBe(403);

    const malformed = await forgotRoute(authedRequest("/api/password/forgot", { email: 42 }));
    expect(malformed.status).toBe(400);
    expectCleanError(await malformed.json());
  });
});

describe("reset-password consume", () => {
  it("round-trips: new password signs in, old sessions die, the link burns", async () => {
    const email = "p5-roundtrip@cafe.test";
    const id = await seedPasswordAccount(email, "P5 Roundtrip");
    await signInCookie(email);
    sentLinks.length = 0;

    await forgotRoute(authedRequest("/api/password/forgot", { email }));
    expect(sentLinks).toHaveLength(1);
    const token = tokenFromUrl(sentLinks[0].url);

    const reset = await resetRoute(
      authedRequest("/api/password/reset", {
        token,
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      })
    );
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ passwordReset: true });
    expect(reset.headers.get("cache-control")).toContain("no-store");

    // Every live session died with the reset, including the one above.
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0);

    // The new password signs in; the old one does not.
    expect((await attemptSignIn(email, NEW_PASSWORD)).status).toBe(200);
    expect((await attemptSignIn(email, PASSWORD)).status).toBe(401);

    // The spent link answers the one failure copy, like an unknown token.
    const replay = await resetRoute(
      authedRequest("/api/password/reset", {
        token,
        password: "another horse 11?",
        confirm: "another horse 11?",
      })
    );
    expect(replay.status).toBe(400);
    const replayPayload = (await replay.json()) as { error: { code: string; message: string } };
    expect(replayPayload.error).toMatchObject({
      code: "invalid_token",
      message: INVALID_RESET_TOKEN_COPY,
    });

    const unknown = await resetRoute(
      authedRequest("/api/password/reset", {
        token: "no-such-token",
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      })
    );
    expect(unknown.status).toBe(400);
    expect((await unknown.json()) as unknown).toEqual(replayPayload);
  });

  it("does not burn the link on a weak new password", async () => {
    const email = "p5-weak@cafe.test";
    await seedPasswordAccount(email, "P5 Weak");
    sentLinks.length = 0;
    await forgotRoute(authedRequest("/api/password/forgot", { email }));
    const token = tokenFromUrl(sentLinks[0].url);

    const weak = await resetRoute(
      authedRequest("/api/password/reset", { token, password: "short", confirm: "short" })
    );
    expect(weak.status).toBe(400);
    expect(((await weak.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_password"
    );

    const retry = await resetRoute(
      authedRequest("/api/password/reset", {
        token,
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      })
    );
    expect(retry.status).toBe(200);
  });

  it("satisfies a forced reset and clears a live lockout", async () => {
    const email = "p5-forced@cafe.test";
    const id = await seedPasswordAccount(email, "P5 Forced");
    const { forcePasswordReset } = await import("@/features/platform/repo");
    await forcePasswordReset(db, { targetUserId: id, actorUserId: operatorId });
    expect((await getAccountAccessState(db, id)).resetRequired).toBe(true);

    // Five wrong passwords while flagged: the counter still counts.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await attemptSignIn(email, "not the password");
    }
    expect((await getAccountAccessState(db, id)).locked).toBe(true);

    sentLinks.length = 0;
    await forgotRoute(authedRequest("/api/password/forgot", { email }));
    const token = tokenFromUrl(sentLinks[0].url);
    const reset = await resetRoute(
      authedRequest("/api/password/reset", {
        token,
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      })
    );
    expect(reset.status).toBe(200);

    const state = await getAccountAccessState(db, id);
    expect(state.resetRequired).toBe(false);
    expect(state.locked).toBe(false);
    expect((await attemptSignIn(email, NEW_PASSWORD)).status).toBe(200);
  });

  it("refuses a suspended account with the generic copy and keeps the link", async () => {
    const email = "p5-suspended@cafe.test";
    const id = await seedPasswordAccount(email, "P5 Suspended");
    await suspendAccount(db, {
      targetUserId: id,
      reason: "abuse_or_spam",
      actorUserId: operatorId,
    });
    sentLinks.length = 0;
    await forgotRoute(authedRequest("/api/password/forgot", { email }));
    const token = tokenFromUrl(sentLinks[0].url);

    const gated = await resetRoute(
      authedRequest("/api/password/reset", {
        token,
        password: NEW_PASSWORD,
        confirm: NEW_PASSWORD,
      })
    );
    expect(gated.status).toBe(403);
    const payload = (await gated.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("account_suspended");
    expect(payload.error.message).toContain("suspended");
    expectCleanError(payload);

    // The link survives the refusal: nothing was burned.
    const rows = await db
      .select({ usedAt: passwordResetToken.usedAt })
      .from(passwordResetToken)
      .where(eq(passwordResetToken.userId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].usedAt).toBeNull();
  });

  it("rate-limits a burst from one connection", async () => {
    const burstIp = "p5-burst-10.9.9.9";
    let blocked = 0;
    for (let attempt = 0; attempt < 13; attempt += 1) {
      const response = await forgotRoute(
        authedRequest("/api/password/forgot", { email: "p5-nobody@cafe.test" }, burstIp)
      );
      if (response.status === 429) {
        blocked += 1;
        const payload = (await response.json()) as { error: { code: string } };
        expect(payload.error.code).toBe("rate_limited");
        expect(response.headers.get("retry-after")).toBe("60");
      } else {
        expect(response.status).toBe(200);
      }
    }
    expect(blocked).toBe(1);
  });
});

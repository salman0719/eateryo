import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { POST as setPasswordRoute } from "@/app/api/account/password/route";
import { getAuth } from "@/lib/auth";
import { takeDevSignInLink } from "@/lib/auth/dev-sign-in";
import { account, accountAccessState } from "@/lib/db/schema";
import { deriveAccessChip, getAccountAccessState } from "@/features/platform/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

process.env.BETTER_AUTH_SECRET ??= "password-auth-test-secret-64-chars-0123456789abcdef";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DEV_SIGN_IN_BYPASS ??= "1";

/**
 * P2 — set a password after link verification (PGlite + real Better Auth
 * handlers, no external services). Public sign-up stays disabled, so the
 * email/password core can store credentials without ever minting an
 * account; the route tests below drive the full chain (verified link →
 * session cookie → set-password → stamped state).
 *
 * Only the guard identity and the DB handle are stubbed (the repo, the
 * hashing, and the route run for real); sessions are minted through the
 * real magic-link flow with the dev bypass parking the link in-process.
 */

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

function authRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

/** An error payload must read as a message, not as internals. */
function expectCleanError(payload: unknown): void {
  const text = JSON.stringify(payload);
  expect(text).not.toMatch(/select\s|insert\s|drizzle|pgtable|neon|stack|Error:/i);
  const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
  expect(typeof error?.code).toBe("string");
  expect(typeof error?.message).toBe("string");
}

/** Mint a real session cookie through the link flow (dev bypass parks it). */
async function signInCookie(email: string): Promise<string> {
  const auth = getAuth();
  const request = await auth.handler(
    authRequest("/api/auth/sign-in/magic-link", { email, callbackURL: "/" })
  );
  expect(request.status).toBe(200);
  const parked = takeDevSignInLink(email);
  expect(parked).not.toBeNull();
  const token = new URL(parked as string).searchParams.get("token");
  expect(token).not.toBeNull();
  const verify = await auth.handler(
    new Request(`http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=/`)
  );
  const cookies = verify.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookies).toContain("better-auth.session_token");
  return cookies;
}

function passwordRequest(body: unknown, cookie: string | null, origin?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  return new Request("http://localhost:3000/api/account/password", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const { db } = await createTestDb();
  holder.db = db;
}, 30_000);

describe("password credential storage", () => {
  it("refuses public email/password sign-up", async () => {
    const auth = getAuth();
    const response = await auth.handler(
      authRequest("/api/auth/sign-up/email", {
        name: "Nope",
        email: "nope@cafe.test",
        password: "correct horse 9!",
      })
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
  });
});

describe("POST /api/account/password", () => {
  let db: TestDb;
  let userId: string;
  let email: string;
  let cookie: string;

  beforeAll(async () => {
    db = holder.db as TestDb;
    email = "p2-setter@cafe.test";
    userId = await seedUser(db, email, "P2 Setter");
    holder.user = { id: userId, email };
    cookie = await signInCookie(email);
    // The stubbed guard only carries the id; point it at the real user.
    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.id).toBe(userId);
  }, 30_000);

  it("refuses an anonymous caller without a verified link's session", async () => {
    holder.user = null;
    const response = await setPasswordRoute(
      passwordRequest({ password: "correct horse 9!", confirm: "correct horse 9!" }, null)
    );
    holder.user = { id: userId, email };
    expect(response.status).toBe(401);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("refuses a cross-origin mutation before the guard runs", async () => {
    const response = await setPasswordRoute(
      passwordRequest(
        { password: "correct horse 9!", confirm: "correct horse 9!" },
        cookie,
        "https://evil.test"
      )
    );
    expect(response.status).toBe(403);
  });

  it("rejects weak, reused, common, and mismatched passwords with the settled copy", async () => {
    const cases: Array<[unknown, string, string]> = [
      [
        { password: "short1!", confirm: "short1!" },
        "invalid_password",
        "Use at least 10 characters.",
      ],
      [
        { password: email, confirm: email },
        "invalid_password",
        "Your password can't be your email address.",
      ],
      [
        { password: "password123", confirm: "password123" },
        "invalid_password",
        "That password is too common. Choose another.",
      ],
      [
        { password: "correct horse 9!", confirm: "correct horse 8!" },
        "invalid_password",
        "The two passwords don't match.",
      ],
    ];
    for (const [body, code, message] of cases) {
      const response = await setPasswordRoute(passwordRequest(body, cookie));
      expect(response.status).toBe(400);
      const payload = (await response.json()) as unknown;
      expect(payload).toMatchObject({ error: { code, message } });
      expectCleanError(payload);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("sets the first password and stamps the access state", async () => {
    const response = await setPasswordRoute(
      passwordRequest({ password: "correct horse 9!", confirm: "correct horse 9!" }, cookie)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ passwordSet: true });
    expect(response.headers.get("cache-control")).toContain("no-store");

    const rows = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
    expect(rows).toHaveLength(1);
    expect(rows[0].password).toBeTruthy();
    expect(rows[0].password).not.toContain("correct horse 9!");

    const state = await getAccountAccessState(db, userId);
    expect(state.passwordSetAt).not.toBeNull();
    expect(state.resetRequired).toBe(false);
    expect(deriveAccessChip(state)).toBe("password_set");
  });

  it("changes the password with the current one and re-stamps", async () => {
    const missing = await setPasswordRoute(
      passwordRequest({ password: "another horse 7?", confirm: "another horse 7?" }, cookie)
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "current_password_required" },
    });

    const wrong = await setPasswordRoute(
      passwordRequest(
        {
          password: "another horse 7?",
          confirm: "another horse 7?",
          currentPassword: "not the password",
        },
        cookie
      )
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({
      error: { code: "invalid_current_password" },
    });

    const before = (await getAccountAccessState(db, userId)).passwordSetAt as string;
    const changed = await setPasswordRoute(
      passwordRequest(
        {
          password: "another horse 7?",
          confirm: "another horse 7?",
          currentPassword: "correct horse 9!",
        },
        cookie
      )
    );
    expect(changed.status).toBe(200);
    const after = (await getAccountAccessState(db, userId)).passwordSetAt as string;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it("clears an outstanding reset and the lockout counter on set", async () => {
    const otherEmail = "p2-reset@cafe.test";
    const otherId = await seedUser(db, otherEmail, "P2 Reset");
    await db.insert(accountAccessState).values({
      userId: otherId,
      resetRequired: true,
      resetSentAt: new Date(),
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    });
    holder.user = { id: otherId, email: otherEmail };
    const otherCookie = await signInCookie(otherEmail);

    const response = await setPasswordRoute(
      passwordRequest({ password: "fresh start 3#", confirm: "fresh start 3#" }, otherCookie)
    );
    holder.user = { id: userId, email };
    expect(response.status).toBe(200);

    const state = await getAccountAccessState(db, otherId);
    expect(state.resetRequired).toBe(false);
    expect(state.resetSentAt).toBeNull();
    expect(state.failedAttempts).toBe(0);
    expect(state.locked).toBe(false);
    expect(deriveAccessChip(state)).toBe("password_set");
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

import { GET as verifyLinkRoute } from "@/app/verify/route";
import { suspendAccount } from "@/features/platform/repo";
import { createAuth } from "@/lib/auth";
import { accountSuspendedMessage } from "@/lib/auth/account-state";
import {
  LINK_FAILED_PATH,
  SUSPENDED_PATH,
  resolveVerifyOutcome,
  safeCallbackURL,
  sameOriginPath,
  toVerifyPageUrl,
  type VerifyHandlerResult,
} from "@/lib/auth/verify-link";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * The `/verify` landing routing: the browser never opens a Better Auth
 * verification URL directly, so a suspended account meets a signed-out
 * page instead of raw 403 JSON — while the reason stays server-side.
 *
 * Pure-helper tests pin the rewrite, the callback guard and the outcome
 * matrix; route tests walk the real handler end to end (suspended →
 * `/suspended` with no session, active → callback with a session cookie,
 * dead/missing token → sign-in with a resend path).
 */

process.env.BETTER_AUTH_SECRET ??= "verify-link-test-secret-64-chars-0123456789abcdef";

const holder: { db: TestDb | null } = { db: null };

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

describe("toVerifyPageUrl", () => {
  it("rewrites the API path, keeping origin, token and routing params", () => {
    const rewritten = toVerifyPageUrl(
      "http://localhost:3200/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fpublish%3Fstate%3D7"
    );
    const parsed = new URL(rewritten);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("http://localhost:3200/verify");
    expect(parsed.searchParams.get("token")).toBe("abc123");
    expect(parsed.searchParams.get("callbackURL")).toBe("/publish?state=7");
    expect(rewritten).not.toContain("/api/auth/");
  });

  it("leaves non-links untouched instead of building a dead page URL", () => {
    expect(toVerifyPageUrl("not a url")).toBe("not a url");
    expect(toVerifyPageUrl("http://localhost:3200/verify?token=abc")).toBe(
      "http://localhost:3200/verify?token=abc"
    );
    expect(toVerifyPageUrl("http://localhost:3200/api/auth/get-session")).toBe(
      "http://localhost:3200/api/auth/get-session"
    );
  });
});

describe("safeCallbackURL", () => {
  it("keeps same-origin paths with their query strings", () => {
    expect(safeCallbackURL("/publish?state=7")).toBe("/publish?state=7");
    expect(safeCallbackURL("/")).toBe("/");
  });

  it("refuses escapes, falling back to home", () => {
    expect(safeCallbackURL(null)).toBe("/");
    expect(safeCallbackURL("")).toBe("/");
    expect(safeCallbackURL("https://evil.test/")).toBe("/");
    expect(safeCallbackURL("//evil.test/")).toBe("/");
    expect(safeCallbackURL("/\\evil.test/")).toBe("/");
  });
});

describe("sameOriginPath", () => {
  it("reduces the endpoint's absolute redirect to a path", () => {
    expect(sameOriginPath("http://localhost:3200/publish?state=7", "http://localhost:3200")).toBe(
      "/publish?state=7"
    );
  });

  it("refuses foreign origins and unusable values", () => {
    expect(sameOriginPath("https://evil.test/", "http://localhost:3200")).toBeNull();
    expect(sameOriginPath(null, "http://localhost:3200")).toBeNull();
  });
});

describe("resolveVerifyOutcome", () => {
  const suspendedMessage = "This account is suspended. Contact support for help.";
  const base: VerifyHandlerResult = {
    status: 302,
    location: "http://localhost:3000/",
    setCookies: [],
    errorMessage: null,
  };

  it("routes the exact suspended copy to the landing, even against noise", () => {
    expect(
      resolveVerifyOutcome({
        result: { ...base, status: 403, errorMessage: suspendedMessage },
        callbackURL: "/",
        suspendedMessage,
        requestOrigin: "http://localhost:3000",
      })
    ).toEqual({ kind: "suspended" });
  });

  it("does not mistake other 403s for a suspension", () => {
    const outcome = resolveVerifyOutcome({
      result: { ...base, status: 403, errorMessage: "Something else broke." },
      callbackURL: "/",
      suspendedMessage,
      requestOrigin: "http://localhost:3000",
    });
    expect(outcome).toEqual({ kind: "failed" });
  });

  it("recognises success by the session cookie and follows the endpoint home", () => {
    const outcome = resolveVerifyOutcome({
      result: {
        ...base,
        setCookies: ["better-auth.session_token=tok; Path=/; HttpOnly"],
      },
      callbackURL: "/fallback",
      suspendedMessage,
      requestOrigin: "http://localhost:3000",
    });
    expect(outcome).toEqual({
      kind: "signed-in",
      redirect: "/",
      forwardCookies: ["better-auth.session_token=tok; Path=/; HttpOnly"],
    });
  });

  it("treats a cookieless redirect as a refusal, not a sign-in", () => {
    // An invalid token answers 302 to `?error=INVALID_TOKEN` with no
    // cookies: following the Location would land home silently signed out.
    const outcome = resolveVerifyOutcome({
      result: { ...base, location: "http://localhost:3000/?error=INVALID_TOKEN" },
      callbackURL: "/",
      suspendedMessage,
      requestOrigin: "http://localhost:3000",
    });
    expect(outcome).toEqual({ kind: "failed" });
  });
});

describe("/verify route through the real handler", () => {
  const BASE_URL = "http://localhost:3000";
  let db: TestDb;
  let linkAuth: ReturnType<typeof createAuth>;
  const sentLinks: string[] = [];

  function locationOf(response: Response): URL {
    const location = response.headers.get("location");
    if (!location) throw new Error("expected a redirect");
    return new URL(location);
  }

  function sessionCookies(response: Response): string[] {
    return response.headers
      .getSetCookie()
      .filter((cookie) => cookie.includes("better-auth.session_token"));
  }

  async function requestLink(email: string): Promise<{ token: string }> {
    const request = await linkAuth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email, callbackURL: "/" }),
      })
    );
    expect(request.status).toBe(200);
    const raw = sentLinks[sentLinks.length - 1];
    if (!raw) throw new Error("no magic link captured");
    const token = new URL(raw).searchParams.get("token");
    if (!token) throw new Error("captured link carries no token");
    return { token };
  }

  beforeAll(async () => {
    ({ db } = await createTestDb());
    holder.db = db;
    linkAuth = createAuth({
      db,
      baseURL: BASE_URL,
      secret: process.env.BETTER_AUTH_SECRET,
      sendMagicLink: async ({ url }) => {
        sentLinks.push(url);
      },
    });
  }, 30_000);

  it("returns an active user to the callback with a session cookie", async () => {
    const email = "verify-active@cafe.test";
    await seedUser(db, email, "Verify Active");
    const { token } = await requestLink(email);

    const response = await verifyLinkRoute(
      new Request(`${BASE_URL}/verify?token=${token}&callbackURL=/`)
    );

    expect(response.status).toBe(302);
    expect(locationOf(response).pathname).toBe("/");
    expect(sessionCookies(response)).toHaveLength(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }, 30_000);

  it("sends a suspended account to the landing with no session", async () => {
    const email = "verify-suspended@cafe.test";
    const targetId = await seedUser(db, email, "Verify Suspended");
    const actorId = await seedUser(db, "verify-actor@cafe.test", "Verify Actor");
    await suspendAccount(db, {
      targetUserId: targetId,
      reason: "abuse_or_spam",
      actorUserId: actorId,
    });
    const { token } = await requestLink(email);

    const response = await verifyLinkRoute(
      new Request(`${BASE_URL}/verify?token=${token}&callbackURL=/`)
    );

    expect(response.status).toBe(302);
    expect(locationOf(response).pathname).toBe(SUSPENDED_PATH);
    expect(sessionCookies(response)).toHaveLength(0);
  }, 30_000);

  it("sends dead and missing tokens to sign-in with a resend path", async () => {
    const dead = await verifyLinkRoute(
      new Request(`${BASE_URL}/verify?token=bogus-token&callbackURL=/`)
    );
    expect(dead.status).toBe(302);
    expect(`${locationOf(dead).pathname}${locationOf(dead).search}`).toBe(LINK_FAILED_PATH);

    const missing = await verifyLinkRoute(new Request(`${BASE_URL}/verify`));
    expect(missing.status).toBe(302);
    expect(`${locationOf(missing).pathname}${locationOf(missing).search}`).toBe(LINK_FAILED_PATH);
  }, 30_000);

  it("never honours a foreign callback, even on success", async () => {
    const email = "verify-callback@cafe.test";
    await seedUser(db, email, "Verify Callback");
    const { token } = await requestLink(email);

    const response = await verifyLinkRoute(
      new Request(
        `${BASE_URL}/verify?token=${token}&callbackURL=${encodeURIComponent("https://evil.test/")}`
      )
    );

    expect(response.status).toBe(302);
    expect(locationOf(response).origin).toBe(BASE_URL);
    expect(sessionCookies(response)).toHaveLength(1);
  }, 30_000);

  it("keeps the suspension reason off the wire", async () => {
    // The generic copy is the whole surface: the route, the landing and
    // the hook all share it, so the reason has nowhere to leak from.
    expect(accountSuspendedMessage()).not.toContain("abuse_or_spam");
  });
});

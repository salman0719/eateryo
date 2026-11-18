import { describe, expect, it } from "vitest";

import {
  SESSION_HINT_COOKIE,
  SESSION_HINT_VALUE,
  hasSessionCookie,
  hasSessionHint,
  readBrowserSessionHint,
} from "@/features/session/session-hint";
import { sessionHintSetCookies, splitSetCookie, withSessionHint } from "@/lib/auth/session-hint";

/**
 * The session hint's contract: the auth-route mirror is its only writer, its
 * absence is proof (no session cookie), its presence is only a question, and
 * it never carries anything worth stealing.
 */
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const OPTIONS = { fallbackMaxAgeSeconds: THIRTY_DAYS };
const SESSION_COOKIE = "better-auth.session_token";
const SECURE_SESSION_COOKIE = "__Secure-better-auth.session_token";
const GET_SESSION = "https://eateryo.test/api/auth/get-session";
const CLEARED_HINT = `${SESSION_HINT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`;

/** The hint line an https exchange is expected to send. */
function expectedHint(maxAgeSeconds: number | null): string {
  const attributes = ["Path=/", "SameSite=Lax"];
  if (maxAgeSeconds !== null) attributes.push(`Max-Age=${maxAgeSeconds}`);
  attributes.push("Secure");
  return `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}; ${attributes.join("; ")}`;
}

function setCookies(headers: Headers): string[] {
  const readAll = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof readAll === "function") return readAll.call(headers);
  const merged = headers.get("set-cookie");
  return merged ? splitSetCookie(merged) : [];
}

function hintLines(headers: Headers): string[] {
  return setCookies(headers).filter((line) => line.startsWith(`${SESSION_HINT_COOKIE}=`));
}

function request(url = GET_SESSION, cookie?: string): Request {
  return new Request(url, cookie ? { headers: { cookie } } : undefined);
}

function responseWith(cookies: string[], body = "{}", status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
}

describe("session hint mirror", () => {
  it("mirrors the session cookie's lifetime onto the hint", () => {
    const response = responseWith([
      `${SESSION_COOKIE}=tok; Max-Age=${THIRTY_DAYS}; Path=/; HttpOnly; SameSite=Lax`,
    ]);

    const next = withSessionHint(request(), response, OPTIONS);

    expect(hintLines(next.headers)).toEqual([expectedHint(THIRTY_DAYS)]);
  });

  it("copies a browser-session cookie's lifetime by leaving Max-Age off", () => {
    expect(
      sessionHintSetCookies({
        requestCookieHeader: null,
        responseSetCookies: [`${SESSION_COOKIE}=tok; Path=/; HttpOnly`],
        secure: true,
        fallbackMaxAgeSeconds: THIRTY_DAYS,
      })
    ).toEqual([`${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}; Path=/; SameSite=Lax; Secure`]);
  });

  it("follows a __Secure- session cookie onto a secure hint", () => {
    const next = withSessionHint(
      request(),
      responseWith([`${SECURE_SESSION_COOKIE}=tok; Max-Age=60; Path=/; Secure`]),
      OPTIONS
    );

    expect(hintLines(next.headers)).toEqual([expectedHint(60)]);
  });

  it("clears the hint when the session cookie is cleared (sign-out, expiry)", () => {
    const next = withSessionHint(
      request(GET_SESSION, `${SESSION_HINT_COOKIE}=1`),
      responseWith([`${SESSION_COOKIE}=; Max-Age=0; Path=/`]),
      OPTIONS
    );

    expect(hintLines(next.headers)).toEqual([CLEARED_HINT]);
  });

  it("repairs a missing hint for a session that already existed (rollout)", () => {
    const next = withSessionHint(
      request(GET_SESSION, `${SESSION_COOKIE}=tok`),
      responseWith([]),
      OPTIONS
    );

    expect(hintLines(next.headers)).toEqual([expectedHint(THIRTY_DAYS)]);
  });

  it("clears a hint whose session cookie has gone (selective clearing)", () => {
    const next = withSessionHint(
      request(GET_SESSION, `${SESSION_HINT_COOKIE}=1`),
      responseWith([]),
      OPTIONS
    );

    expect(hintLines(next.headers)).toEqual([CLEARED_HINT]);
  });

  it("does nothing when the request and the session already agree", () => {
    const response = responseWith([]);
    const next = withSessionHint(
      request(GET_SESSION, `${SESSION_HINT_COOKIE}=1; ${SESSION_COOKIE}=tok`),
      response,
      OPTIONS
    );

    expect(next).toBe(response);
  });

  it("leaves a response that says nothing about the session untouched", () => {
    const response = responseWith(["eateryo.ff=assistant; Path=/; HttpOnly"]);
    const next = withSessionHint(request(), response, OPTIONS);

    expect(next).toBe(response);
    expect(setCookies(next.headers)).toEqual(["eateryo.ff=assistant; Path=/; HttpOnly"]);
  });

  it("keeps the response's status, body and other cookies", () => {
    const next = withSessionHint(
      request(),
      responseWith(
        [`${SESSION_COOKIE}=tok; Max-Age=60; Path=/`, "eateryo.ff=assistant; Path=/"],
        "ok",
        201
      ),
      OPTIONS
    );

    expect(next.status).toBe(201);
    expect(setCookies(next.headers)).toEqual([
      `${SESSION_COOKIE}=tok; Max-Age=60; Path=/`,
      "eateryo.ff=assistant; Path=/",
      expectedHint(60),
    ]);
  });

  it("is a flag JavaScript can read, never a credential", () => {
    const next = withSessionHint(
      request(),
      responseWith([`${SESSION_COOKIE}=secret-token; Max-Age=60; Path=/; HttpOnly`]),
      OPTIONS
    );
    const [line] = hintLines(next.headers);

    expect(line).toContain(`${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}`);
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("HttpOnly");
  });

  it("keeps Secure on the request scheme when no session cookie names it", () => {
    const http = withSessionHint(
      request("http://localhost:3200/api/auth/get-session", `${SESSION_COOKIE}=tok`),
      responseWith([]),
      OPTIONS
    );

    expect(hintLines(http.headers)[0]).not.toContain("Secure");
  });

  it("splits a merged Set-Cookie header without cutting a date in half", () => {
    const merged =
      "eateryo.ff=assistant; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/, better-auth.session_token=; Max-Age=0; Path=/";

    expect(splitSetCookie(merged)).toEqual([
      "eateryo.ff=assistant; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
      "better-auth.session_token=; Max-Age=0; Path=/",
    ]);
  });
});

describe("session hint reads", () => {
  it("reads the flag from a Cookie header, and an empty value as absent", () => {
    expect(hasSessionHint(`a=1; ${SESSION_HINT_COOKIE}=1`)).toBe(true);
    expect(hasSessionHint(`a=1; ${SESSION_HINT_COOKIE}=`)).toBe(false);
    expect(hasSessionHint(null)).toBe(false);
  });

  it("recognises every prefixed form of the session cookie", () => {
    expect(hasSessionCookie(`${SESSION_COOKIE}=tok`)).toBe(true);
    expect(hasSessionCookie(`${SECURE_SESSION_COOKIE}=tok`)).toBe(true);
    expect(hasSessionCookie(`__Host-${SESSION_COOKIE}=tok`)).toBe(true);
    expect(hasSessionCookie(`${SESSION_COOKIE}=`)).toBe(false);
    expect(hasSessionCookie("eateryo.ff=assistant")).toBe(false);
  });

  it("answers unknown, never none, where there is no document", () => {
    // This is the prerendered frame's snapshot: an unread hint must never be
    // mistaken for evidence of a visitor, or hydration would contradict the
    // server's markup.
    expect(readBrowserSessionHint()).toBe("unknown");
  });
});

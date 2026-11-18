/**
 * The session hint: one bit the browser can read before the session answers.
 *
 * The session lives in an `HttpOnly` cookie JavaScript cannot see, so a page
 * load cannot tell "nobody is signed in" from "somebody might be, the server
 * has not answered yet" — both arrive as `{ data: null, isPending: true }`.
 * That is why `decideSessionState` calls the second one `unknown` and the
 * shell holds its neutral placeholder. This cookie carries the missing bit:
 * **absent means no session token is in this browser's jar**, present means
 * "a session may exist, ask".
 *
 * Deliberate properties:
 * - **Server-written only.** The hint is set, extended and cleared by the auth
 *   response mirror (`src/lib/auth/session-hint.ts`), never by browser code,
 *   so it cannot drift from the cookie it describes. A browser that never
 *   signed in never carries one.
 * - **A flag, never a credential.** One value, `1`. No account id, no email,
 *   no copy of the session token. A forged or stale hint costs one redundant
 *   session read and nothing else.
 * - **Not `HttpOnly`**, because the whole point is that the browser reads it
 *   — so it may only choose what a screen *shows*. Guards, ownership checks
 *   and data reads still come from the server's answer.
 *
 * This module is pure and client-safe; the server mirror adds the `Set-Cookie`
 * writing on top of it.
 */

/** The readable flag. Present (and non-empty) = "a session may exist". */
export const SESSION_HINT_COOKIE = "eateryo.session-hint";
/** The only value the hint ever holds. */
export const SESSION_HINT_VALUE = "1";

/**
 * What the boot script leaves on `<html>`: `hinted` or `none`.
 *
 * CSS reads it (`globals.css`), so a screen can be chosen before the first
 * paint rather than in a React render. Never read it in a guard: it is the
 * same display-only flag as the hint, one layer earlier.
 */
export const SESSION_HINT_ATTR = "data-session";

/**
 * Runs in `<body>` before the shell is painted (see `layout.tsx`).
 *
 * The hint cannot be applied by a render. `useSessionHint()` has no snapshot
 * before hydration — the prerendered markup cannot know the request's cookies
 * — and by the time React re-renders with `document.cookie`, the session read
 * has usually answered too, so a hint-gated frame never gets a commit of its
 * own. That is what made the reserved signed-in frame invisible: you saw the
 * neutral frame, then the resolved screen, and never the middle.
 *
 * Reading the cookie here makes the decision before layout instead, so the
 * returning account's loader and the visitor's screen are both right at the
 * first paint. Inline and synchronous on purpose: an effect runs after paint.
 * An empty value reads as absent, exactly like `hasSessionHint`, and a
 * refused write leaves the attribute unset — which the CSS reads as "no
 * loader", never as a stuck one.
 */
export const SESSION_BOOT_SCRIPT =
  `try{var n=${JSON.stringify(SESSION_HINT_COOKIE)},v="none";` +
  `document.cookie.split(";").forEach(function(c){c=c.trim();` +
  `if(c.slice(0,n.length+1)===n+"="&&c.length>n.length+1){v="hinted"}});` +
  `document.documentElement.setAttribute(${JSON.stringify(SESSION_HINT_ATTR)},v)}catch(e){}`;

/**
 * Better Auth's session cookie, and the prefixes it may carry. The secure
 * prefix is `__Secure-` (https), and a host-only deployment uses `__Host-`.
 */
const SESSION_COOKIE_BASE = "better-auth.session_token";

/** True for any prefixed form of the session cookie's name. */
export function isSessionCookieName(name: string): boolean {
  return (
    name === SESSION_COOKIE_BASE ||
    name === `__Secure-${SESSION_COOKIE_BASE}` ||
    name === `__Host-${SESSION_COOKIE_BASE}`
  );
}

/** A `Cookie` request header as a name → value map (first occurrence wins). */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || cookies.has(name)) continue;
    cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

/** Did this request present the hint? An empty value reads as absent. */
export function hasSessionHint(header: string | null | undefined): boolean {
  return (parseCookieHeader(header).get(SESSION_HINT_COOKIE) ?? "") !== "";
}

/** Did this request present a session cookie with a value? */
export function hasSessionCookie(header: string | null | undefined): boolean {
  for (const [name, value] of parseCookieHeader(header)) {
    if (value !== "" && isSessionCookieName(name)) return true;
  }
  return false;
}

/** What the browser knows about the hint right now. */
export type SessionHint = "hinted" | "none" | "unknown";

/**
 * The hint as the browser can see it. `unknown` is what the prerendered frame
 * uses — no document, or a cookie read that threw. It must never be confused
 * with `none`: `none` is the reader's one piece of evidence.
 */
export function readBrowserSessionHint(): SessionHint {
  if (typeof document === "undefined") return "unknown";
  try {
    return hasSessionHint(document.cookie) ? "hinted" : "none";
  } catch {
    return "unknown";
  }
}

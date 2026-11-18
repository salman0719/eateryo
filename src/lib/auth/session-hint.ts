/**
 * The session hint's only writer: an auth response mirror.
 *
 * The readable `eateryo.session-hint` flag (`src/features/session/session-hint`)
 * has to be as trustworthy as the `HttpOnly` cookie it describes, and the only
 * code that knows when that cookie is set, extended or cleared is the auth
 * route. So the flag is never written from the app: this module inspects the
 * response Better Auth just produced and mirrors the session cookie into it.
 *
 * Rules, in order:
 * 1. The response sets (or refreshes) the session cookie → set the hint with
 *    the same lifetime. Sign-in, the rolling refresh and magic-link
 *    verification all land here.
 * 2. The response clears the session cookie → clear the hint. Sign-out, an
 *    expired session and a revoked one all land here.
 * 3. The request carried a session cookie but no hint → set the hint for the
 *    session window. This is the rollout and drift repair: sessions created
 *    before this shipped start carrying the flag on their first auth request,
 *    instead of every load flashing the visitor's screen at an owner.
 * 4. The request carried the hint but no session cookie → clear the hint.
 *    Selective cookie clearing leaves exactly this drift; without this rule a
 *    visitor would wait on every load for an answer that is always "nobody".
 *
 * Everything else returns the response untouched. Nothing here is
 * authoritative: the hint only shortens the shell's wait, so a bug degrades
 * to today's behaviour (wait for the session read) rather than to a hole.
 */

import {
  SESSION_HINT_COOKIE,
  SESSION_HINT_VALUE,
  hasSessionCookie,
  hasSessionHint,
  isSessionCookieName,
} from "@/features/session/session-hint";

/** Expiry date used when a cookie is deleted; the value is never read back. */
const CLEARED_EXPIRES = "Thu, 01 Jan 1970 00:00:00 GMT";

export interface SessionHintOptions {
  /**
   * Lifetime used by rule 3, where there is no session cookie on the response
   * to mirror. Callers pass the session window so the repaired hint cannot
   * outlive the session by more than the session itself can.
   */
  fallbackMaxAgeSeconds: number;
}

interface ParsedSetCookie {
  name: string;
  value: string;
  /** `null` when the cookie is a browser-session cookie. */
  maxAgeSeconds: number | null;
  clearing: boolean;
}

/**
 * Split a merged `Set-Cookie` header into individual cookies.
 *
 * Only a fallback for runtimes without `Headers.getSetCookie()`, and written
 * carefully for the reason that function exists: `Expires` carries a comma
 * (`Thu, 01 Jan 1970 …`), so a plain `split(",")` corrupts the cookie. A
 * comma starts a new cookie only when a cookie name follows it.
 */
export function splitSetCookie(header: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < header.length; index++) {
    if (header[index] !== ",") continue;
    // A date's comma is followed by a day number, so no `name=` matches it.
    if (!/^\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=/.test(header.slice(index + 1))) continue;
    parts.push(header.slice(start, index).trim());
    start = index + 1;
  }
  const tail = header.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

function parseSetCookie(header: string): ParsedSetCookie | null {
  const separator = header.indexOf("=");
  if (separator <= 0) return null;
  const name = header.slice(0, separator).trim();
  if (!name) return null;

  const rest = header.slice(separator + 1);
  const parameters = rest.indexOf(";");
  const value = (parameters === -1 ? rest : rest.slice(0, parameters)).trim();

  let maxAgeSeconds: number | null = null;
  let expires: string | null = null;
  for (const attribute of (parameters === -1 ? "" : rest.slice(parameters + 1)).split(";")) {
    const equals = attribute.indexOf("=");
    if (equals === -1) continue;
    const key = attribute.slice(0, equals).trim().toLowerCase();
    const attributeValue = attribute.slice(equals + 1).trim();
    if (key === "max-age") {
      const parsed = Number.parseInt(attributeValue, 10);
      if (Number.isFinite(parsed)) maxAgeSeconds = parsed;
    } else if (key === "expires") {
      expires = attributeValue;
    }
  }

  const expired = expires !== null && Date.parse(expires) <= Date.now();
  const clearing = value === "" || (maxAgeSeconds !== null && maxAgeSeconds <= 0) || expired;
  return { name, value, maxAgeSeconds, clearing };
}

/** The `Cookie` request header's cookies, however the runtime exposes them. */
function readSetCookies(headers: Headers): string[] {
  const readAll = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof readAll === "function") return readAll.call(headers);
  const merged = headers.get("set-cookie");
  return merged ? splitSetCookie(merged) : [];
}

function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The hint cookies this exchange should send, given what the request presented
 * and what the response changed. Empty means the hint needs no update.
 */
export function sessionHintSetCookies(input: {
  requestCookieHeader: string | null;
  responseSetCookies: readonly string[];
  secure: boolean;
  fallbackMaxAgeSeconds: number;
}): string[] {
  const entries = input.responseSetCookies
    .map(parseSetCookie)
    .filter((entry): entry is ParsedSetCookie => entry !== null && isSessionCookieName(entry.name));

  // `Secure` follows the cookie jar actually in use, not just the request
  // scheme: a `__Secure-` session cookie implies one.
  const secure = input.secure || entries.some((entry) => entry.name.startsWith("__Secure-"));

  const setting = entries.find((entry) => !entry.clearing);
  if (setting) return [hintCookie({ secure, maxAgeSeconds: setting.maxAgeSeconds })];

  if (entries.some((entry) => entry.clearing)) return [clearedHintCookie({ secure })];

  const requestHasHint = hasSessionHint(input.requestCookieHeader);
  const requestHasSession = hasSessionCookie(input.requestCookieHeader);
  if (requestHasSession && !requestHasHint) {
    return [hintCookie({ secure, maxAgeSeconds: input.fallbackMaxAgeSeconds })];
  }
  if (requestHasHint && !requestHasSession) return [clearedHintCookie({ secure })];

  return [];
}

function hintCookie(input: { secure: boolean; maxAgeSeconds: number | null }): string {
  const attributes = ["Path=/", "SameSite=Lax"];
  if (input.maxAgeSeconds !== null && input.maxAgeSeconds > 0) {
    attributes.push(`Max-Age=${Math.floor(input.maxAgeSeconds)}`);
  }
  if (input.secure) attributes.push("Secure");
  return `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}; ${attributes.join("; ")}`;
}

function clearedHintCookie(input: { secure: boolean }): string {
  const attributes = ["Path=/", "SameSite=Lax", "Max-Age=0", `Expires=${CLEARED_EXPIRES}`];
  if (input.secure) attributes.push("Secure");
  return `${SESSION_HINT_COOKIE}=; ${attributes.join("; ")}`;
}

/**
 * The auth route's response, with the hint mirrored onto it. Untouched when
 * the exchange said nothing about the session, so ordinary auth reads cost no
 * extra header.
 */
export function withSessionHint(
  request: Request,
  response: Response,
  options: SessionHintOptions
): Response {
  const hintCookies = sessionHintSetCookies({
    requestCookieHeader: request.headers.get("cookie"),
    responseSetCookies: readSetCookies(response.headers),
    secure: isSecureRequest(request),
    fallbackMaxAgeSeconds: options.fallbackMaxAgeSeconds,
  });
  if (hintCookies.length === 0) return response;

  const headers = new Headers(response.headers);
  for (const cookie of hintCookies) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

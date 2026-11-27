/**
 * Magic-link landing routing — the browser never opens a Better Auth
 * verification URL directly.
 *
 * The emailed (or dev-parked) link points at the first-party `/verify`
 * route, which walks the real verification endpoint server-side and sorts
 * the outcome: a minted session returns to the requested page with its
 * cookies, a suspended account lands on the signed-out `/suspended` page,
 * and anything else (dead, used, malformed) lands on sign-in with a resend
 * path. The suspension reason stays server-side throughout — the landing
 * only ever carries the generic copy, and `/verify` never echoes the token
 * back into a page.
 *
 * Pure helpers, so the routing matrix is unit-testable without HTTP; the
 * `/verify` route is the only caller of `resolveVerifyOutcome`.
 */
import { isSessionCookieName } from "@/features/session/session-hint";

/** First-party page that walks the real verification endpoint. */
export const VERIFY_PATH = "/verify";
/** Signed-out landing for links refused over an open suspension. */
export const SUSPENDED_PATH = "/suspended";
/** Where dead, used or malformed links land — it explains and resends. */
export const LINK_FAILED_PATH = "/sign-in?error=link";

/**
 * The Better Auth verification URL the sender was given, rewritten to the
 * first-party page. Origin, token and routing params survive; the API path
 * does not. Anything we do not recognise passes through untouched, which
 * fails open to today's direct-verify behaviour rather than to a dead link.
 */
export function toVerifyPageUrl(authUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(authUrl);
  } catch {
    return authUrl;
  }
  const token = parsed.searchParams.get("token");
  if (!token) return authUrl;
  const verify = new URL(VERIFY_PATH, parsed.origin);
  verify.searchParams.set("token", token);
  for (const key of ["callbackURL", "newUserCallbackURL"] as const) {
    const value = parsed.searchParams.get(key);
    if (value !== null) verify.searchParams.set(key, value);
  }
  return verify.toString();
}

/**
 * The return address the link asked for, or `/` when it is missing or
 * points anywhere but this origin. Only single-`/` paths survive: `//`
 * and `/\` are protocol-relative escapes, and absolute URLs are someone
 * else's page. The query string is kept — wizard deep links carry state.
 */
export function safeCallbackURL(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/**
 * The verification endpoint's own redirect target, reduced to a path when
 * it stays on this origin. Success for a first-time user may point at
 * `newUserCallbackURL` rather than the callback — following the endpoint's
 * answer preserves that without ever leaving the origin.
 */
export function sameOriginPath(location: string | null | undefined, origin: string): string | null {
  if (!location) return null;
  try {
    const target = new URL(location, origin);
    if (target.origin !== new URL(origin).origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

/**
 * The server-side request the route walks the verification endpoint with.
 * Pure so the mapping is unit-testable: the token and routing params cross
 * over, both callbacks are same-origin-guarded, and the inbound
 * `x-forwarded-for` rides along so the endpoint's IP bucket matches a
 * direct hit. A `null` callback means absent (the endpoint falls back to
 * its own default); `forwardedFor` copies verbatim — trusting or
 * distrusting it is the endpoint's job, exactly as on a direct call.
 */
export function buildVerifyHandlerRequest(input: {
  origin: string;
  token: string;
  callbackURL: string | null;
  newUserCallbackURL: string | null;
  forwardedFor: string | null;
}): Request {
  const verifyUrl = new URL("/api/auth/magic-link/verify", input.origin);
  verifyUrl.searchParams.set("token", input.token);
  verifyUrl.searchParams.set("callbackURL", safeCallbackURL(input.callbackURL));
  if (input.newUserCallbackURL !== null) {
    verifyUrl.searchParams.set("newUserCallbackURL", safeCallbackURL(input.newUserCallbackURL));
  }
  const headers = new Headers();
  if (input.forwardedFor) headers.set("x-forwarded-for", input.forwardedFor);
  return new Request(verifyUrl.toString(), { headers });
}

/** What the route read off the verification endpoint's response. */
export interface VerifyHandlerResult {
  status: number;
  location: string | null;
  setCookies: string[];
  /** The error body's message, when the endpoint answered an error as JSON. */
  errorMessage: string | null;
}

export type VerifyOutcome =
  /** A session was minted: return there, carrying its cookies. */
  | { kind: "signed-in"; redirect: string; forwardCookies: string[] }
  /** The exact suspended copy, and nothing else, earns the landing. */
  | { kind: "suspended" }
  /** Everything else: dead token, malformed request, endpoint trouble. */
  | { kind: "failed" };

function hasSessionCookie(setCookies: readonly string[]): boolean {
  return setCookies.some((cookie) => {
    const separator = cookie.indexOf("=");
    const name = (separator === -1 ? cookie : cookie.slice(0, separator)).trim();
    return isSessionCookieName(name);
  });
}

/**
 * Sort the verification answer. Suspension is matched on the endpoint's
 * exact generic message (the one function that writes it, compared with
 * `===` — no substring, no code field to drift), and it wins over
 * everything: the gate throws before any cookie is minted, so a response
 * carrying both would be a contradiction. Success is recognised by a
 * session cookie, never by status alone — a bare redirect without one is
 * the endpoint declining (invalid token), not a sign-in.
 */
export function resolveVerifyOutcome(input: {
  result: VerifyHandlerResult;
  callbackURL: string;
  suspendedMessage: string;
  requestOrigin: string;
}): VerifyOutcome {
  const { result } = input;
  if (result.status === 403 && result.errorMessage === input.suspendedMessage) {
    return { kind: "suspended" };
  }
  if (hasSessionCookie(result.setCookies)) {
    return {
      kind: "signed-in",
      redirect: sameOriginPath(result.location, input.requestOrigin) ?? input.callbackURL,
      forwardCookies: [...result.setCookies],
    };
  }
  return { kind: "failed" };
}

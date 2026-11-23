import { NextResponse } from "next/server";

/**
 * Same-origin guard for state-changing requests (Step 11 hardening).
 *
 * Browsers enforce CORS on *reading* a response, but a cross-site `POST` with
 * a JSON or form body is still delivered and executed — so a page on another
 * site could make a signed-in owner's browser republish or delete a menu.
 * Session cookies are the credential here, which makes that CSRF.
 *
 * The rule: when a request declares an `Origin`, its host must match the host
 * that served the app. Requests with no `Origin` (curl, server-to-server,
 * older same-origin form posts) are allowed — they are not a browser sending
 * someone else's cookie.
 *
 * `Origin: null` (sandboxed iframe, `file://`) and a declared `cross-site`
 * fetch mode are always refused. This is a second line behind SameSite
 * session cookies, not a replacement for them.
 */

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The hosts this request could legitimately have been served by. */
function requestHosts(request: Request): string[] {
  return ["host", "x-forwarded-host"]
    .map((name) => request.headers.get(name)?.split(",")[0]?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
}

export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }

  const origin = request.headers.get("origin");
  // No Origin header: not a cross-site browser request (see the note above).
  if (origin === null) return true;
  if (origin === "null") return false;

  const originHost = hostOf(origin);
  if (!originHost) return false;
  return requestHosts(request).includes(originHost);
}

/** The 403 every mutation returns when the guard refuses it. */
export function crossOriginResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "cross_origin_rejected", message: "This request came from another site." } },
    { status: 403 }
  );
}

/** Null when the request may proceed; a 403 response when it may not. */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  return isSameOriginRequest(request) ? null : crossOriginResponse();
}

/**
 * The origin Stripe return URLs are minted against.
 *
 * The browser that taps pay declares its page in `Origin`, and it is the
 * only party that can follow the redirect — so a declared, well-formed
 * same-host origin wins over the server-perceived `request.url`. That URL
 * is only the fallback (curl and server-to-server posts carry no Origin),
 * because behind a proxy or on a dev LAN it names the machine, not the
 * diner's page: a phone tap once minted `http://localhost:3100/…` links
 * the phone could never open. A declared origin that fails this module's
 * own host check, or that is not http(s), falls back too — so the helper
 * stays safe on routes that don't run the guard above.
 */
export function preferredReturnOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      const sameHost = requestHosts(request).includes(url.host.toLowerCase());
      if (sameHost && (url.protocol === "http:" || url.protocol === "https:")) {
        return url.origin;
      }
    } catch {
      // Unparseable Origin: fall through to the request URL below.
    }
  }
  return new URL(request.url).origin;
}

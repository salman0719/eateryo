import { NextResponse } from "next/server";

import { SESSION_EXPIRES_IN_SECONDS, getAuth } from "@/lib/auth";
import { accountSuspendedMessage } from "@/lib/auth/account-state";
import { withSessionHint } from "@/lib/auth/session-hint";
import {
  LINK_FAILED_PATH,
  SUSPENDED_PATH,
  resolveVerifyOutcome,
  safeCallbackURL,
} from "@/lib/auth/verify-link";
import { loopbackOrigin } from "@/lib/http/loopback";

/**
 * GET /verify?token=…&callbackURL=… — every magic link handed out (emailed
 * or dev-parked) points here instead of at the verification endpoint.
 *
 * The route walks the real Better Auth verification server-side and turns
 * its answer into a same-origin redirect: a minted session returns to the
 * requested page carrying its cookies, a suspended account lands on the
 * signed-out `/suspended` page, and anything else (dead, used, malformed,
 * or an endpoint that itself stumbles) lands on sign-in with a resend path.
 * The suspension reason never leaves the server — suspension is recognised
 * by the endpoint's exact generic copy, and the token is spent here, never
 * rendered into a page.
 *
 * Like the auth route, every response passes through the session-hint
 * mirror, so a fresh sign-in carries the flag from its first response; and
 * like every suspension surface, redirects are `no-store` (the URL holds a
 * one-time credential either way).
 */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return null;
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
    const nested = (body as { error?: unknown }).error;
    if (
      typeof nested === "object" &&
      nested !== null &&
      typeof (nested as { message?: unknown }).message === "string"
    ) {
      return (nested as { message: string }).message;
    }
  } catch {
    // A non-JSON error body is not ours; the failed branch handles it.
  }
  return null;
}

function finish(request: Request, redirect: string, forwardCookies: string[]): Response {
  const response = NextResponse.redirect(new URL(redirect, request.url), { status: 302 });
  for (const cookie of forwardCookies) response.headers.append("set-cookie", cookie);
  response.headers.set("Cache-Control", "no-store");
  return withSessionHint(request, response, {
    fallbackMaxAgeSeconds: SESSION_EXPIRES_IN_SECONDS,
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token") ?? "";
  const callbackURL = safeCallbackURL(requestUrl.searchParams.get("callbackURL"));

  const verifyUrl = new URL("/api/auth/magic-link/verify", requestUrl.origin);
  verifyUrl.searchParams.set("token", token);
  verifyUrl.searchParams.set("callbackURL", callbackURL);
  const newUserCallbackURL = requestUrl.searchParams.get("newUserCallbackURL");
  if (newUserCallbackURL) verifyUrl.searchParams.set("newUserCallbackURL", newUserCallbackURL);

  let handlerRes: Response;
  try {
    handlerRes = await getAuth(loopbackOrigin(request)).handler(new Request(verifyUrl.toString()));
  } catch {
    // The endpoint itself stumbled (DB down, misconfigured secret): no
    // session could exist, so the resend path is the honest answer.
    return finish(request, LINK_FAILED_PATH, []);
  }

  const outcome = resolveVerifyOutcome({
    result: {
      status: handlerRes.status,
      location: handlerRes.headers.get("location"),
      setCookies: handlerRes.headers.getSetCookie(),
      errorMessage: handlerRes.status === 403 ? await readErrorMessage(handlerRes) : null,
    },
    callbackURL,
    suspendedMessage: accountSuspendedMessage(),
    requestOrigin: requestUrl.origin,
  });

  switch (outcome.kind) {
    case "signed-in":
      return finish(request, outcome.redirect, outcome.forwardCookies);
    case "suspended":
      return finish(request, SUSPENDED_PATH, []);
    case "failed":
      return finish(request, LINK_FAILED_PATH, []);
  }
}

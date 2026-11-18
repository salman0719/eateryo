import { toNextJsHandler } from "better-auth/next-js";

import { SESSION_EXPIRES_IN_SECONDS, getAuth } from "@/lib/auth";
import { withSessionHint } from "@/lib/auth/session-hint";
import { loopbackOrigin } from "@/lib/http/loopback";

// Better Auth catch-all: /api/auth/sign-in/magic-link, /api/auth/get-session,
// magic-link verification, sign-out, etc. The auth instance is created lazily
// on first request so builds and DB-less local mode stay unaffected.
//
// In development the request's loopback origin becomes the auth base URL, so
// whichever local port serves the app is also the origin links return to.
const handlers = toNextJsHandler((request) => getAuth(loopbackOrigin(request)).handler(request));

/**
 * Every auth response passes through the session-hint mirror.
 *
 * The readable `eateryo.session-hint` flag is set, extended and cleared here
 * and nowhere else, so its absence is proof that this browser holds no session
 * cookie rather than a client's guess. The shell uses that one bit to skip its
 * placeholder for a visitor; nothing authoritative ever reads it. See
 * `src/lib/auth/session-hint.ts` for the four rules and their reasons.
 */
export async function GET(request: Request) {
  return withSessionHint(request, await handlers.GET(request), {
    fallbackMaxAgeSeconds: SESSION_EXPIRES_IN_SECONDS,
  });
}

export async function POST(request: Request) {
  return withSessionHint(request, await handlers.POST(request), {
    fallbackMaxAgeSeconds: SESSION_EXPIRES_IN_SECONDS,
  });
}

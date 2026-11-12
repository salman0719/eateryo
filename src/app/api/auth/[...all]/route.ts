import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";
import { loopbackOrigin } from "@/lib/http/loopback";

// Better Auth catch-all: /api/auth/sign-in/magic-link, /api/auth/get-session,
// magic-link verification, sign-out, etc. The auth instance is created lazily
// on first request so builds and DB-less local mode stay unaffected.
//
// In development the request's loopback origin becomes the auth base URL, so
// whichever local port serves the app is also the origin links return to.
export const { GET, POST } = toNextJsHandler((request) =>
  getAuth(loopbackOrigin(request)).handler(request)
);

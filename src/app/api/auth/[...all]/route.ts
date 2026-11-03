import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * A loopback origin may act as the auth base URL while developing, whatever
 * port the server was started on. The value comes from the request URL, not
 * a Host header we trust blindly, and production never takes this path.
 */
function developmentOrigin(request: Request): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  try {
    const url = new URL(request.url);
    if (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]"
    ) {
      return url.origin;
    }
  } catch {
    // A malformed URL keeps the configured base URL; Better Auth will answer.
  }
  return undefined;
}

// Better Auth catch-all: /api/auth/sign-in/magic-link, /api/auth/get-session,
// magic-link verification, sign-out, etc. The auth instance is created lazily
// on first request so builds and DB-less local mode stay unaffected.
export const { GET, POST } = toNextJsHandler((request) =>
  getAuth(developmentOrigin(request)).handler(request)
);

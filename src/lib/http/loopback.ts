/**
 * The request's origin when it is a loopback host in development.
 *
 * A dev server is often started on a port other than BETTER_AUTH_URL. Auth
 * links and invitation links must point at the port actually serving them,
 * or the recipient lands on a dead address or is refused as a foreign
 * origin. Production returns undefined so the configured URL always wins.
 */
export function loopbackOrigin(request: Request): string | undefined {
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
    // A malformed URL falls back to the configured base URL.
  }
  return undefined;
}

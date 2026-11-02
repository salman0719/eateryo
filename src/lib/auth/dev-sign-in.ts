/**
 * Development-only sign-in shortcut: **capture the magic link instead of
 * emailing it.**
 *
 * Local sign-in otherwise needs a working `RESEND_API_KEY` (or a glance at the
 * dev server console). With `DEV_SIGN_IN_BYPASS=1` in `.env.local`, the auth
 * instance hands the freshly minted link to this module's small in-memory
 * store, and the sign-in page fetches it through `/api/dev/magic-link` and
 * offers it as an explicit "open the link" button.
 *
 * Deliberate properties:
 * - **Not a direct login.** The browser still walks the real verification
 *   route, so a session is created by Better Auth's own magic-link flow, not
 *   by a hand-written session insert. Nothing here can mint a session.
 * - **Never in production.** `NODE_ENV === "production"` turns the flag off
 *   even when the variable is set, and every caller (sender choice, route,
 *   page prop) asks this module first — so shipped code has no path to it.
 * - **Explicit.** The link is shown on the page and must be clicked; the UI
 *   says it is a development shortcut in as many words.
 * - **One-time and short-lived.** A link can be read back once, only for the
 *   address that requested it, and only for five minutes — the same window
 *   Better Auth gives the link itself.
 */

/** Matches the magic-link expiry the auth config sets. */
const DEV_LINK_TTL_MS = 5 * 60 * 1000;

/**
 * Is the dev sign-in shortcut allowed in this process? Production is always
 * false, whatever the environment says.
 */
export function isDevSignInEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  const value = (env.DEV_SIGN_IN_BYPASS ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export interface DevLinkStore {
  /** Hold the link the auth server just generated. */
  remember(email: string, url: string): void;
  /** Read it back once, for the same address, inside the window. */
  take(email: string): string | null;
  /** Forget any pending link (signing out, or a dead link). */
  clear(): void;
}

/**
 * Single-slot store, injectable clock so the expiry is testable. Only the most
 * recent request is kept: dev sign-in is one person at one keyboard.
 */
export function createDevLinkStore(now: () => number = Date.now): DevLinkStore {
  let pending: { email: string; url: string; createdAt: number } | null = null;
  const normalise = (email: string) => email.trim().toLowerCase();

  return {
    remember(email, url) {
      pending = { email: normalise(email), url, createdAt: now() };
    },
    take(email) {
      if (!pending) return null;
      if (pending.email !== normalise(email)) return null;
      if (now() - pending.createdAt > DEV_LINK_TTL_MS) {
        pending = null;
        return null;
      }
      const { url } = pending;
      pending = null;
      return url;
    },
    clear() {
      pending = null;
    },
  };
}

const store = createDevLinkStore();

/**
 * `sendMagicLink` replacement used only when the bypass is on: it delivers
 * nothing and parks the link where the dev route can read it.
 */
export async function captureDevSignInLink({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  if (!isDevSignInEnabled()) {
    // Unreachable through the auth config, and never a silent success.
    throw new Error("Dev sign-in bypass is not enabled");
  }
  store.remember(email, url);
}

/** The pending link for this address, consumed on read; null when unavailable. */
export function takeDevSignInLink(email: string): string | null {
  if (!isDevSignInEnabled()) return null;
  return store.take(email);
}

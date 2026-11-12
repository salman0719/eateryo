/**
 * What a session read has actually established — and what that lets a menu
 * URL do (015).
 *
 * The signed-in flag is not server truth: Better Auth's session atom starts
 * empty on every page load and answers one network round trip later. Its
 * first observable state is `{ data: null, isPending: true }`, so "nothing is
 * known yet" and "the server said nobody" are different answers and must not
 * share a predicate. Collapsing them made every reload of a menu URL read as
 * signed out and accuse the owner of their own menu.
 *
 * Pure, so the matrix is unit-tested without a browser or the auth client.
 */

/** What a session read has established right now. */
export type SessionState = "signed-in" | "signed-out" | "unknown";

export interface SessionRead {
  /** `session?.user != null` from the auth client. */
  hasUser: boolean;
  /** The atom's `isPending`: a read is in flight, or none has run yet. */
  pending: boolean;
  /** The atom's `error`; `null` when the last read answered. */
  error: unknown;
}

/** The HTTP status a failed auth-client read carries, when it carries one. */
export function sessionErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * `unknown` is its own answer: a read still in flight has not established
 * anything, and neither has one that failed. Only a read that actually
 * answered — a successful empty response, or Better Auth's 401 for it — is a
 * sign-out.
 */
export function decideSessionState(read: SessionRead): SessionState {
  if (read.hasUser) return "signed-in";
  if (read.pending) return "unknown";
  if (sessionErrorStatus(read.error) === 401) return "signed-out";
  if (read.error) return "unknown";
  return "signed-out";
}

/** Why a menu URL did not open. */
export type MenuBlockReason = "signed-out" | "other-account";

/**
 * `wait` = the session has not answered, so nothing may be refused yet;
 * `open` = this caller may read the row; `blocked` = the row exists on this
 * device but belongs to somebody else.
 */
export type MenuOpenDecision =
  { state: "wait" } | { state: "open" } | { state: "blocked"; reason: MenuBlockReason };

/** What a blocked menu says — true, and with a next step. */
export const SESSION_BLOCKED_MESSAGES: Record<MenuBlockReason, string> = {
  "signed-out": "That menu belongs to an account on this device — sign in to open it.",
  "other-account":
    "That menu is saved on this device for a different account — sign in with that account to open it.",
};

export function menuOpenBlockedMessage(reason: MenuBlockReason): string {
  return SESSION_BLOCKED_MESSAGES[reason];
}

/** True when a library message is this ownership wall, not some other error. */
export function isSessionGateMessage(message: string | null): boolean {
  if (!message) return false;
  return Object.values(SESSION_BLOCKED_MESSAGES).includes(message);
}

/**
 * Which of this device's rows a menu URL may open.
 *
 * The device stamp is a privacy boundary, not a claim about the caller: a row
 * stamped to the signed-in account is simply the account's own copy, an
 * unstamped row is the shared anonymous working set, and a row stamped to
 * somebody else stays shut. An unanswered session decides nothing.
 */
export function decideMenuOpen(input: {
  session: SessionState;
  /** Account id in the row's device stamp; empty = no stamp. */
  stampAccountId?: string | null;
  /** The signed-in caller's account id. */
  accountKey: string | null;
  /**
   * The server listed this menu for the signed-in caller as a published-only
   * reader. The cached row may be stamped to the account that wrote the
   * draft, but the published snapshot is shared content and may be opened.
   */
  sharedPublished?: boolean;
  /**
   * The account's menu list has not answered yet. A row stamped to somebody
   * else may still be on that list as a shared published menu, so refusing it
   * now would bounce a direct URL to the library before the list arrives.
   */
  accountReadPending?: boolean;
}): MenuOpenDecision {
  if (input.session === "unknown") return { state: "wait" };
  if (input.session === "signed-in" && input.sharedPublished) return { state: "open" };
  const stamp = input.stampAccountId ?? "";
  if (
    input.session === "signed-in" &&
    input.accountReadPending &&
    stamp !== "" &&
    stamp !== input.accountKey
  ) {
    return { state: "wait" };
  }
  if (!stamp) return { state: "open" };
  if (input.session === "signed-out") return { state: "blocked", reason: "signed-out" };
  return stamp === input.accountKey
    ? { state: "open" }
    : { state: "blocked", reason: "other-account" };
}

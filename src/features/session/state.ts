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

import type { SessionHint } from "./session-hint";

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

/**
 * Whether the shell should hold its neutral placeholder while the read is
 * still out.
 *
 * The hint cannot answer for the server, but its *absence* answers one
 * question on its own: no session token is in this browser's jar, so there is
 * nothing to wait for and the visitor's screen is already true. A present hint
 * — and an unread one, which is what the prerendered frame sees — waits
exactly as before.
 *
 * This is display only. `sessionState` stays the server's answer and every
 * guard, ownership check and data read keeps using it, so a missing hint can
 * shorten a skeleton but can never bounce a URL or open a surface.
 */
export function sessionAnswerPending(input: { state: SessionState; hint: SessionHint }): boolean {
  if (input.state !== "unknown") return false;
  return input.hint !== "none";
}

/**
 * Whether the full-screen session loader covers the shell.
 *
 * A returning account should never watch the shell assemble itself: the
 * session answers, then the café, then the library, and each answer used to
 * move the logo sideways and make a column appear. Covering the frame until
 * all three have answered means the signed-in shape is revealed once, already
 * complete — so nothing has to be reserved or matched to anything.
 *
 * Display only, like `sessionAnswerPending`. Two hand-overs matter, because a
 * loader that outlives a failed read is a spinner nobody can leave:
 * - a session read that gave up (`sessionCheckGaveUp`) belongs to the shell's
 *   own "Checking your session…" card, which offers Try again;
 * - a café read that settled by *failing* keeps `pending` true by design (the
 *   list is still `null`), so waiting on it would never end — the shell shows
 *   the failure instead.
 *
 * A visitor is never covered: `sessionPending` is already false for an absent
 * hint. An unread hint (the prerendered frame) leaves the CSS rule, not this
 * function, deciding whether the element is even visible.
 */
export function sessionLoaderCovers(input: {
  /** The session read is still out (see `sessionAnswerPending`). */
  sessionPending: boolean;
  /** The session read used up its retries; the shell owns the recovery. */
  sessionCheckGaveUp: boolean;
  signedIn: boolean;
  /** The café the shell acts in has not been resolved yet. */
  workspacePending: boolean;
  /** That read settled by failing: a wait that would never end. */
  workspaceFailed: boolean;
  /** The browser's first library read has not settled. */
  libraryLoading: boolean;
}): boolean {
  if (input.sessionCheckGaveUp) return false;
  if (input.sessionPending) return true;
  if (!input.signedIn) return false;
  return (input.workspacePending && !input.workspaceFailed) || input.libraryLoading;
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

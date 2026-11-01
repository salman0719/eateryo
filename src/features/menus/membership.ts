/**
 * Where the open menu is saved — and knowing when that cannot be answered yet.
 *
 * The account's menu ids arrive in a set that is empty until the read
 * finishes, so a lookup is only an answer once that read has settled (001).
 * The editor used to fill the gap with "Saved in this browser", which is false
 * for every menu the account holds, and offered "Add it to your account" for
 * one it already had (003). A menu's own proof — its id being in the set
 * already — outranks an unread list, so a deep link that just synced is never
 * reported as unknown.
 *
 * A read can also settle by **failing**. Folding that into "not on the
 * account" is the same false claim in a different costume, and it re-offered
 * the café-creating publish flow for a menu the account may already hold, so
 * the failure is its own answer: `unreachable` (016).
 */

export type MenuMembership = "account" | "browser" | "unknown" | "unreachable";

export function decideMenuMembership(input: {
  /** False means no account exists that could hold this menu. */
  signedIn: boolean;
  /** The account's menu list finished being read, however it ended. */
  readSettled: boolean;
  /** That read ended in an error, so the id set proves nothing. */
  readFailed: boolean;
  /** This menu's id is in the known set (from the list, or its own read). */
  onServer: boolean;
}): MenuMembership {
  if (!input.signedIn) return "browser";
  if (input.onServer) return "account";
  if (!input.readSettled) return "unknown";
  if (input.readFailed) return "unreachable";
  return "browser";
}

/**
 * The same decision as the `boolean | null` the editor and publish panel take:
 * `true` on the account, `false` proved browser-only, `null` not answered yet.
 *
 * `unreachable` also maps to `null`, because "I could not check" is not a
 * storage location — and it is not a wait either. Surfaces that need to tell
 * the two apart take the failure as its own prop (016).
 */
export function membershipFlag(membership: MenuMembership): boolean | null {
  if (membership === "account") return true;
  if (membership === "browser") return false;
  return null;
}

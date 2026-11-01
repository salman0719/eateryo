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
 */

export type MenuMembership = "account" | "browser" | "unknown";

export function decideMenuMembership(input: {
  /** False means no account exists that could hold this menu. */
  signedIn: boolean;
  /** The account's menu list finished being read, however it ended. */
  readSettled: boolean;
  /** This menu's id is in the known set (from the list, or its own read). */
  onServer: boolean;
}): MenuMembership {
  if (!input.signedIn) return "browser";
  if (input.onServer) return "account";
  if (!input.readSettled) return "unknown";
  return "browser";
}

/**
 * The same decision as the `boolean | null` the editor and publish panel take:
 * `true` on the account, `false` proved browser-only, `null` not read yet.
 */
export function membershipFlag(membership: MenuMembership): boolean | null {
  if (membership === "account") return true;
  if (membership === "browser") return false;
  return null;
}

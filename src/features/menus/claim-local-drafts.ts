/**
 * Claiming the drafts that exist only in this browser (R1).
 *
 * Sign-in is the one moment that claims. An account with no menus adopts
 * every browser draft in one go; an account that already holds menus is
 * *offered* the same import. Both paths use the same one-way move helper,
 * which marks each row with the account — so a claimed row never renders
 * signed out again. A shared device deliberately swallows: whoever signs in
 * first owns what was in the browser, and that is the documented trade
 * for having no forks, no queues, no per-device scoping matrix.
 *
 * The decision is pure so it can be tested without a browser; only the
 * per-account "done / not now" memory touches localStorage, and it fails
 * quiet when storage is unavailable.
 */

export type LocalDraftClaimStatus = "unseen" | "dismissed" | "done";

export type LocalDraftClaimAction = "auto-import" | "offer" | "none";

export interface LocalDraftClaimInputs {
  /** Menus saved in this browser that the account does not hold yet. */
  localCount: number;
  /** Menus the signed-in account already holds on the server. */
  accountMenuCount: number;
  /** Restaurants the caller belongs to, in any role. */
  restaurantCount: number;
  /** Restaurants the caller owns (only owners can import menus). */
  ownedRestaurantCount: number;
  /** This account's remembered answer, if any. */
  status: LocalDraftClaimStatus;
}

/**
 * No menus on the account means every browser draft is adopted at sign-in —
 * restaurants do not matter, because the auto-import creates one when
 * needed. An account that already holds menus gets a one-click offer
 * instead. Staff-only accounts with menus are left alone: they own no
 * restaurant to import into, so the manual panel is the honest place to
 * explain that.
 */
export function decideLocalDraftClaim(inputs: LocalDraftClaimInputs): LocalDraftClaimAction {
  if (inputs.localCount <= 0) return "none";
  if (inputs.status !== "unseen") return "none";
  if (inputs.accountMenuCount === 0) return "auto-import";
  if (inputs.ownedRestaurantCount === 0) return "none";
  return "offer";
}



const STORAGE_PREFIX = "eateryo:local-draft-claim:";
const BROWSER_ACCOUNT_KEY = "eateryo:browser-account";

/** Stable per-account key; exported for tests and storage diagnostics. */
export function localDraftClaimKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLocalDraftClaim(userId: string): LocalDraftClaimStatus {
  const storage = browserStorage();
  if (!storage) return "unseen";
  try {
    const value = storage.getItem(localDraftClaimKey(userId));
    return value === "done" || value === "dismissed" ? value : "unseen";
  } catch {
    return "unseen";
  }
}

function writeClaimStatus(userId: string, status: Exclude<LocalDraftClaimStatus, "unseen">): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(localDraftClaimKey(userId), status);
  } catch {
    // The offer may reappear next time; that is recoverable, unlike losing
    // the drafts themselves.
  }
}

/** The account this browser was last used with (null = never signed in). */
export function loadBrowserAccount(): string | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    return storage.getItem(BROWSER_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/** Remember the account after a successful sign-in. */
export function rememberBrowserAccount(userId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(BROWSER_ACCOUNT_KEY, userId);
  } catch {
    // Without it, a later account is offered the manual import instead of an
    // automatic one. Slower, never wrong.
  }
}

/** The import finished; do not ask again for this account. */
export function markLocalDraftsClaimed(userId: string): void {
  writeClaimStatus(userId, "done");
}

/** "Not now": keep the manual import available, but stop offering. */
export function dismissLocalDraftClaim(userId: string): void {
  writeClaimStatus(userId, "dismissed");
}

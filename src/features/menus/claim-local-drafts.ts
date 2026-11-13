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

import { suggestRestaurantName } from "@/features/menu/menu-utils";

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
 * restaurant ownership does not change *whether* to adopt, because
 * {@link resolveAutoClaimTarget} reuses a café the account already owns and
 * mints one only when it owns none. An account that already holds menus gets
 * a one-click offer instead. Staff-only accounts with menus are left alone:
 * they own no restaurant to import into, so the manual panel is the honest
 * place to explain that.
 */
export function decideLocalDraftClaim(inputs: LocalDraftClaimInputs): LocalDraftClaimAction {
  if (inputs.localCount <= 0) return "none";
  if (inputs.status !== "unseen") return "none";
  if (inputs.accountMenuCount === 0) return "auto-import";
  if (inputs.ownedRestaurantCount === 0) return "none";
  return "offer";
}

/**
 * The onboarding promise ("Sign in to publish your menu"): the draft opened
 * in the publish wizard attaches to the owner's workspace on sign-in, with
 * no prior-menu check. The emailed magic link names that menu, so a
 * returning account with five menus still adopts the journey draft — the
 * link is explicit consent for *it*.
 */
export function decidePublishJourneyClaim(input: {
  signedIn: boolean;
  /** The shell acts in a membership that may file menus (or will own a new café). */
  mayFile: boolean;
  /** This browser holds the journey draft and the account does not. */
  journeyDraftLocal: boolean;
  /** This account+menu pair already ran the journey attach this session. */
  alreadyClaimed: boolean;
}): boolean {
  return input.signedIn && input.mayFile && input.journeyDraftLocal && !input.alreadyClaimed;
}

/** The only part of a restaurant the automatic claim reads. */
export interface AutoClaimRestaurant {
  id: string;
  name: string;
}

/**
 * Where an automatic claim puts this browser's drafts.
 *
 * `reuse` — the account already owns a café (it may simply hold no menus
 * yet, e.g. a previous claim whose import failed); the drafts belong there.
 * `create` — the account owns none, so the claim needs a home and names one
 * from the drafts' titles.
 */
export type AutoClaimTarget =
  | { kind: "reuse"; restaurantId: string; restaurantName: string }
  | { kind: "create"; name: string };

/**
 * Pick the café an automatic draft claim targets: the one the account already
 * owns, otherwise a new one. Never mints a second café behind the owner's
 * back — the automatic path has no way to ask which café it meant, so an
 * existing café always wins.
 *
 * Pass the restaurants the caller *owns* (the server only lets owners import
 * menus); a staff-only account owns none and keeps today's behaviour of
 * getting its own café for its own drafts. Several owned cafés is
 * unreachable while one café per account holds (006); if that is ever lifted
 * this becomes an ask-don't-guess question.
 */
export function resolveAutoClaimTarget(
  ownedRestaurants: readonly AutoClaimRestaurant[],
  titles: readonly string[]
): AutoClaimTarget {
  const existing = ownedRestaurants[0];
  if (existing) {
    return { kind: "reuse", restaurantId: existing.id, restaurantName: existing.name };
  }
  return { kind: "create", name: suggestRestaurantName([...titles]) ?? "My restaurant" };
}

/**
 * Whether one account read has settled, and how.
 *
 * Three states, not two. A failed read used to look exactly like one still in
 * flight — both left the marker unset — so the resume banner and the
 * automatic import silently never ran, and nothing said they had been
 * skipped (002). `failed` is still *unknown*, never "empty": see
 * {@link decideLocalDraftClaimSurface}.
 */
export type AccountReadState = "loading" | "ready" | "failed";

/** What one read (menus, restaurants) has settled to for the account on screen. */
export function accountReadState(input: {
  /** The account being rendered; null while the session is unresolved. */
  accountKey: string | null;
  /** The account a settled answer belongs to; null = nothing settled yet. */
  settledFor: string | null;
  /** The account whose read failed, until a later read succeeds. */
  failedFor: string | null;
}): AccountReadState {
  if (input.accountKey === null) return "loading";
  if (input.settledFor === input.accountKey) return "ready";
  if (input.failedFor === input.accountKey) return "failed";
  return "loading";
}

export interface ClaimGate {
  /** The session or an account read is still in flight. */
  pending: boolean;
  /** The reads are in, but at least one failed — the counts are unknown. */
  incomplete: boolean;
}

/** Collapse the session and both account reads into the gate they feed. */
export function deriveClaimGate(input: {
  sessionPending: boolean;
  signedIn: boolean;
  menus: AccountReadState;
  restaurants: AccountReadState;
}): ClaimGate {
  if (input.sessionPending) return { pending: true, incomplete: false };
  if (!input.signedIn) return { pending: false, incomplete: false };
  return {
    pending: input.menus === "loading" || input.restaurants === "loading",
    incomplete: input.menus === "failed" || input.restaurants === "failed",
  };
}

/** The claim surface this frame may show. */
export type LocalDraftClaimSurface = LocalDraftClaimAction | "pending" | "unavailable";

/**
 * `unavailable` is a real answer, not a stand-in for "none": the account's
 * inventory could not be read, so its counts are unknown. Importing on an
 * unknown would push this browser's drafts at a café we cannot see, so both
 * server paths wait for a read that actually settled. The local-only resume
 * server paths wait for a read that actually settled. The resume banner has
 * its own gate ({@link resumeBannerReady}): it names a menu as an unpublished
 * browser draft, which is only local truth once the account list answered.
 */
export function decideLocalDraftClaimSurface(input: {
  gate: ClaimGate;
  signedIn: boolean;
  claim: LocalDraftClaimInputs;
}): LocalDraftClaimSurface {
  if (input.gate.pending) return "pending";
  if (input.gate.incomplete) return "unavailable";
  return input.signedIn ? decideLocalDraftClaim(input.claim) : "none";
}

/**
 * Whether the resume banner may render at all.
 *
 * It exists for someone who wandered off — or followed the magic link back —
 * with a draft they never published, and it is the only route back that works
 * with no account. Its copy is narrower than the claim surfaces', though: it
 * names one menu as *saved in this browser, not published yet*, which is read
 * off `serverIds`. That set is empty both before the account list arrives and
 * after its read fails, so in both states **every** menu would look like an
 * unclaimed draft — and the banner would offer an account menu, already
 * published or not, as one (017). The signed-in banner therefore waits for the
 * menu list to have answered (`ready`); a failed read is a settled answer, but
 * not one that can tell these menus apart, so the 002 notice explains the
 * skip instead. Signed out, there is no list to wait for: the library is the
 * whole truth.
 */
export function resumeBannerReady(input: {
  /** IndexedDB still being read — nothing is known about this browser yet. */
  libraryLoading: boolean;
  gate: ClaimGate;
  signedIn: boolean;
  /** The account's menu list answered for this account. */
  accountMenusSettled: boolean;
}): boolean {
  if (input.libraryLoading) return false;
  if (input.gate.pending) return false;
  return !input.signedIn || input.accountMenusSettled;
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

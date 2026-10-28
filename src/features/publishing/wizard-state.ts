/**
 * Client-side state for the R1 publish wizard.
 *
 * The draft itself already survives a round trip through the magic-link email
 * because it lives in IndexedDB. This module covers the rest of the form:
 * restaurant name, chosen restaurant, link and style are kept in
 * localStorage so signing in never makes the owner fill the form again.
 *
 * The helpers are pure except for the three storage functions, which fail
 * silently when storage is unavailable (private mode, quota, SSR).
 *
 * There is no link-name field: onboarding never asks the owner to name a
 * menu or pick its address. A first menu is "Main Menu" (or the service the
 * photo clearly names, e.g. "Lunch"), its direct address is derived from
 * that title, and a café with one live menu answers at its own `/r/<café>`
 * link. Addresses are editable afterwards in the editor.
 */

import { suggestRestaurantName } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import {
  DEFAULT_PREVIEW_LAYOUT_ID,
  DEFAULT_PREVIEW_THEME_ID,
  isPreviewLayoutId,
  isPreviewThemeId,
  type PreviewLayoutId,
  type PreviewThemeId,
} from "@/features/menu/preview-themes";
import type { RestaurantOption } from "@/features/tenancy/client";

export interface PublishWizardState {
  /** Only used to create a restaurant when the owner has none. */
  restaurantName: string;
  /** The owner's choice when they have more than one restaurant. */
  restaurantId: string;
  theme: PreviewThemeId;
  layout: PreviewLayoutId;
}

const STORAGE_PREFIX = "eateryo:publish-wizard:";

/** Deep link for the wizard; also the magic-link return address. */
export function publishWizardPath(menuId: string): string {
  return `/menus/${encodeURIComponent(menuId)}/publish`;
}

export function wizardStorageKey(menuId: string): string {
  return `${STORAGE_PREFIX}${menuId}`;
}

/** Prefill the short form from the draft, with nothing invented.
 *
 * The café name comes from the title the photo carried, not from the menu's
 * own (now normalised) title: a photo of "Sunny Side Café" becomes the main
 * menu, and "Sunny Side Café" is still the café to publish under. */
export function defaultWizardState(
  doc: Pick<MenuDocument, "title" | "source">
): PublishWizardState {
  return {
    restaurantName: suggestRestaurantName([doc.source?.originalTitle ?? doc.title]) ?? "",
    restaurantId: "",
    theme: DEFAULT_PREVIEW_THEME_ID,
    layout: DEFAULT_PREVIEW_LAYOUT_ID,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate stored state field by field instead of trusting the whole blob:
 * a single stale enum value must not discard the rest of the form.
 */
export function parseWizardState(value: unknown, fallback: PublishWizardState): PublishWizardState {
  if (!isRecord(value)) return fallback;
  return {
    restaurantName:
      typeof value.restaurantName === "string" ? value.restaurantName : fallback.restaurantName,
    restaurantId:
      typeof value.restaurantId === "string" ? value.restaurantId : fallback.restaurantId,
    theme: isPreviewThemeId(value.theme) ? value.theme : fallback.theme,
    layout: isPreviewLayoutId(value.layout) ? value.layout : fallback.layout,
  };
}

function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadWizardState(menuId: string, fallback: PublishWizardState): PublishWizardState {
  const storage = browserStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(wizardStorageKey(menuId));
    if (!raw) return fallback;
    return parseWizardState(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function saveWizardState(menuId: string, state: PublishWizardState): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(wizardStorageKey(menuId), JSON.stringify(state));
  } catch {
    // Filling the form again is recoverable; failing the publish is not.
  }
}

export function clearWizardState(menuId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(wizardStorageKey(menuId));
  } catch {
    // Nothing to do: a stale form is harmless.
  }
}

/**
 * Whether publish was opened from the review screen.
 *
 * The publish screen continues the same four-stop journey only when the
 * flow came through upload, extraction and review. A menu opened straight
 * from My menus has no marker, so it gets a plain heading rather than a
 * tracker claiming three stops are done. The marker lives in localStorage
 * because the magic-link return reloads the page.
 */
const JOURNEY_STORAGE_PREFIX = "eateryo:publish-journey:";

export function publishJourneyStorageKey(menuId: string): string {
  return `${JOURNEY_STORAGE_PREFIX}${menuId}`;
}

export function rememberPublishJourney(menuId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(publishJourneyStorageKey(menuId), "1");
  } catch {
    // The publish screen just shows a plain heading; nothing else changes.
  }
}

export function hasPublishJourney(menuId: string): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    return storage.getItem(publishJourneyStorageKey(menuId)) !== null;
  } catch {
    return false;
  }
}

export function forgetPublishJourney(menuId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(publishJourneyStorageKey(menuId));
  } catch {
    // Nothing to do: the marker only hides chrome.
  }
}

/** How long an emailed link stays valid (mirrors the server's 5 minutes). */
export const WIZARD_LINK_TTL_MS = 5 * 60 * 1000;
/** A sent panel older than this is ancient history, not a pending link. */
const WIZARD_LINK_MAX_AGE_MS = 10 * 60 * 1000;

/** A magic link the owner is waiting on — restores the "check email" panel
 * across remounts, reloads, and tab switches. */
export interface WizardLinkSent {
  email: string;
  sentAt: number;
}

const LINK_STORAGE_PREFIX = "eateryo:publish-wizard-link:";

export function wizardLinkStorageKey(menuId: string): string {
  return `${LINK_STORAGE_PREFIX}${menuId}`;
}

export function loadWizardLinkSent(menuId: string): WizardLinkSent | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(wizardLinkStorageKey(menuId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.email !== "string" || parsed.email.length === 0) return null;
    if (typeof parsed.sentAt !== "number" || !Number.isFinite(parsed.sentAt)) return null;
    if (Date.now() - parsed.sentAt > WIZARD_LINK_MAX_AGE_MS) return null;
    return { email: parsed.email, sentAt: parsed.sentAt };
  } catch {
    return null;
  }
}

export function saveWizardLinkSent(menuId: string, sent: WizardLinkSent): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(wizardLinkStorageKey(menuId), JSON.stringify(sent));
  } catch {
    // The panel just won't survive a reload; the emailed link still works.
  }
}

export function clearWizardLinkSent(menuId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(wizardLinkStorageKey(menuId));
  } catch {
    // Nothing to do: a stale panel is harmless.
  }
}

/** Countdown copy for the sent panel; pure so tests can pin the wording. */
export function linkExpiryCopy(sentAt: number, now: number): { expired: boolean; text: string } {
  const remaining = Math.min(WIZARD_LINK_TTL_MS, WIZARD_LINK_TTL_MS - (now - sentAt));
  if (remaining <= 0) return { expired: true, text: "That link has expired." };
  const minutes = Math.ceil(remaining / 60000);
  if (minutes <= 1) return { expired: false, text: "It expires in less than a minute." };
  return { expired: false, text: `It expires in about ${minutes} min.` };
}

/** Where the menu will land, given the account and the form. */
export type WizardRestaurantChoice =
  | { kind: "existing"; id: string; name: string }
  | { kind: "create"; name: string }
  | { kind: "choose" }
  | { kind: "missing" };

/**
 * The auto-provision rule in one place: an existing restaurant is always
 * preferred; a new one is only created when the owner has none and has
 * confirmed a name. Multiple restaurants without a choice ask instead of
 * guessing.
 */
export function resolveWizardRestaurant(
  state: Pick<PublishWizardState, "restaurantId" | "restaurantName">,
  owned: readonly RestaurantOption[]
): WizardRestaurantChoice {
  if (owned.length === 1 && owned[0]) {
    return { kind: "existing", id: owned[0].id, name: owned[0].name };
  }
  const selected = owned.find((candidate) => candidate.id === state.restaurantId);
  if (selected) {
    return { kind: "existing", id: selected.id, name: selected.name };
  }
  if (owned.length > 0) return { kind: "choose" };

  const name = state.restaurantName.trim();
  return name ? { kind: "create", name } : { kind: "missing" };
}

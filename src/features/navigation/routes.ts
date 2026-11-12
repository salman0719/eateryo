import type { SessionState } from "@/features/session/state";
import type { Capability } from "@/features/tenancy/permissions";

export type AppScreen =
  "capture" | "library" | "orders" | "assistant" | "tables" | "settings" | "editor" | "item";

/**
 * The surface shown for an open menu: the edit workspace, the compact
 * reorder list, the customer preview, or the publish wizard (R1). Table QR
 * cards moved to the Tables tab (R0), so there is no `qr`
 * mode. Each mode has its own deep-linkable URL.
 */
export type EditorMode = "edit" | "reorder" | "preview" | "publish";

export type AppRoute =
  | { screen: "capture" | "library" | "orders" | "assistant" | "tables" | "settings" }
  | { screen: "editor"; menuId: string; mode: EditorMode }
  | { screen: "item"; menuId: string; itemId: string };

/** The menu a route names: the editor's menu, or the one an item belongs to. */
export function routeMenuId(route: AppRoute): string | null {
  return route.screen === "editor" || route.screen === "item" ? route.menuId : null;
}

/** Decode a menu URL into its menu id plus optional mode or item id. */
export function menuSelectionFromPathname(
  pathname: string
): { menuId: string; mode?: EditorMode; itemId?: string } | null {
  const menuMatch = /^\/menus\/([^/]+)(?:\/(reorder|preview|publish)|\/items\/([^/]+))?$/.exec(
    pathname
  );
  if (!menuMatch?.[1]) return null;
  try {
    const menuId = decodeURIComponent(menuMatch[1]).trim();
    if (!menuId) return null;
    const [, , modeSegment, rawItemId] = menuMatch;
    if (modeSegment === "reorder" || modeSegment === "preview" || modeSegment === "publish") {
      return { menuId, mode: modeSegment };
    }
    if (rawItemId !== undefined) {
      const itemId = decodeURIComponent(rawItemId).trim();
      return itemId ? { menuId, itemId } : null;
    }
    return { menuId };
  } catch {
    return null;
  }
}

export function menuIdFromPathname(pathname: string): string | null {
  return menuSelectionFromPathname(pathname)?.menuId ?? null;
}

/**
 * Why a publish link resolves nowhere: it only ever points at the draft it
 * was created from, so a dead one almost always means the sign-in link was
 * opened in a different browser than the one holding the draft (drafts
 * never leave their device until they are published). Shared by the library
 * banner and the missing-draft card so the two never drift apart.
 */
export const MISSING_PUBLISH_DRAFT_MESSAGE =
  "That link opened in a browser without your draft. Drafts stay on the device " +
  "they were made on until they are published — open the sign-in link in the " +
  "original browser, then continue to your link there.";

/**
 * What to say when a menu URL resolves nowhere — not in this browser, not
 * on the account. Publish links get the wrong-browser explanation above;
 * everything else keeps the generic "deleted or moved".
 */
export function unresolvableMenuMessage(route: AppRoute): string {
  if (route.screen === "editor" && route.mode === "publish") {
    return MISSING_PUBLISH_DRAFT_MESSAGE;
  }
  return "That menu could not be opened. It may have been deleted or moved.";
}

/**
 * Where the shell lands when a real session ends. Sign-out is a privacy
 * boundary: an open editor or capture result can hold an account menu, so
 * the shell dismisses those surfaces and returns to Capture. Local menus
 * are never deleted — anonymous drafts remain in My menus — and an initial
 * signed-out load (never signed in) must not redirect. Returning null means
 * no boundary action is due.
 */
export function signOutLandingRoute(input: {
  wasSignedIn: boolean;
  signedIn: boolean;
}): AppRoute | null {
  return input.wasSignedIn && !input.signedIn ? { screen: "capture" } : null;
}

/** Read an application screen from a URL, defaulting unknown URLs to capture. */
export function parseAppRoute(input: string | URL): AppRoute {
  const url = input instanceof URL ? input : new URL(input, "https://eateryo.invalid");
  if (url.pathname === "/") return { screen: "capture" };
  if (url.pathname === "/menus") return { screen: "library" };
  if (url.pathname === "/orders") return { screen: "orders" };
  if (url.pathname === "/assistant") return { screen: "assistant" };
  if (url.pathname === "/tables") return { screen: "tables" };
  if (url.pathname === "/settings") return { screen: "settings" };

  const selection = menuSelectionFromPathname(url.pathname);
  if (selection?.itemId) {
    return { screen: "item", menuId: selection.menuId, itemId: selection.itemId };
  }
  if (selection) {
    return { screen: "editor", menuId: selection.menuId, mode: selection.mode ?? "edit" };
  }
  if (url.pathname.startsWith("/menus/")) return { screen: "library" };
  return { screen: "capture" };
}

export type AppSectionId = "capture" | "library" | "orders" | "assistant" | "tables" | "settings";

/**
 * One section of the shell and the capability that opens it.
 *
 * This table is the only place a destination enters the navigation. The
 * desktop pills, the phone tab bar and the More sheet are all derived from
 * `availableSections`, so a section added later cannot appear ungated — and a
 * membership that lacks the capability loses the section everywhere at once.
 * Pure data so tests can pin the order without rendering the shell.
 */
export interface AppSection {
  id: AppSectionId;
  label: string;
  /** Any one of these opens the section. */
  capabilities: readonly Capability[];
  /** Where it lives on a phone: the bottom bar or the More sheet. */
  phone: "bar" | "more";
  /** More-sheet position, lower first (the bar keeps `APP_SECTIONS` order). */
  moreRank?: number;
  /** The More sheet's one-line reason. */
  why?: string;
  /** The bottom bar's glyph; the label carries the accessible name. */
  icon?: string;
  /**
   * Filled in by the shell, never by the table: how many menus the library is
   * showing in the active café, once that number is a fact.
   */
  count?: number;
}

/**
 * Desktop order, which is also the order the guard tries when it has to move
 * someone off a surface they cannot use. Capture is the owner's home, My menus
 * the first surface a staff shift can use.
 *
 * Flags are not capabilities (the Assistant's release flag is separate), but
 * every section that needs a permission names it here and nowhere else.
 */
export const APP_SECTIONS = [
  {
    id: "capture",
    label: "Capture",
    capabilities: ["menus.write"],
    phone: "bar",
    icon: "📸",
  },
  {
    id: "library",
    label: "My menus",
    capabilities: ["menus.read"],
    phone: "bar",
    icon: "📚",
  },
  {
    id: "orders",
    label: "Orders",
    capabilities: ["orders.read"],
    phone: "bar",
    icon: "🧾",
  },
  {
    id: "assistant",
    label: "Assistant",
    capabilities: ["assistant.use"],
    phone: "more",
    moreRank: 20,
    why: "Guided fixes and answers",
  },
  {
    id: "tables",
    label: "Tables",
    capabilities: ["tables.print", "tables.link"],
    phone: "more",
    moreRank: 10,
    why: "QR cards per table",
  },
  {
    id: "settings",
    label: "Settings",
    capabilities: ["settings.read"],
    phone: "more",
    moreRank: 30,
    why: "Restaurant · Team · Usage",
  },
] as const satisfies readonly AppSection[];

/** Everything the nav needs to know about the person looking at it. */
export interface SectionAccess {
  signedIn: boolean;
  /** The active membership's capability answer, never a union of memberships. */
  can: (capability: Capability) => boolean;
  /** The Assistant's release flag (its kill switch, A4). */
  assistantEnabled: boolean;
  /** Signed out only: this browser holds anonymous drafts to continue. */
  hasWorkingSet: boolean;
}

/**
 * The sections this person may see, in desktop order.
 *
 * Signed in, only capabilities decide (bar the Assistant's release flag).
 * Signed out the shell is capture-only, plus My menus while anonymous drafts
 * exist to continue — no account surface and no More sheet, whatever a stale
 * capability or the flag says.
 */
export function availableSections(access: SectionAccess): AppSection[] {
  if (!access.signedIn) {
    return APP_SECTIONS.filter(
      (section) => section.id === "capture" || (section.id === "library" && access.hasWorkingSet)
    );
  }
  return APP_SECTIONS.filter((section) => {
    if (section.id === "assistant" && !access.assistantEnabled) return false;
    return section.capabilities.some((capability) => access.can(capability));
  });
}

/**
 * Whether the shell shows its left column at all.
 *
 * The column is the account's: destinations, the open menu's outline, the
 * sign-in button and the café on shift. With nobody signed in it would hold a
 * single row — "Capture" — which reads as a broken menu rather than a front
 * door, so a settled visitor gets the page instead and `brand-bar.tsx` carries
 * the name and `/sign-in`.
 *
 * One case keeps it besides an account: a visitor with anonymous drafts, for
 * whom My menus is a real destination. An unanswered session keeps nothing:
 * the column is the account's, so rendering it before the read settles
 * flashes account chrome at a fresh visitor (and a settled visitor's entry
 * at nobody yet known). The shell holds a neutral placeholder until the
 * session and the library have both answered instead of guessing either way.
 */
export function shellColumnVisible(input: {
  sessionState: SessionState;
  hasWorkingSet: boolean;
}): boolean {
  if (input.sessionState === "signed-in") return true;
  if (input.sessionState === "unknown") return false;
  return input.hasWorkingSet;
}

/**
 * R0 phone nav: the bottom tab bar pins the sections marked `bar`, so the
 * R0.3 order monitor keeps a persistent home for its badge. Everything else
 * lives in the More sheet, led by Tables. Derived from the filtered list, so
 * a hidden section cannot survive in either renderer; the glyphs come from
 * the shared icon set in the shell, so this stays pure data tests can pin.
 */
export interface PhoneTab {
  id: AppSectionId;
  label: string;
}

export function phoneTabs(sections: readonly AppSection[]): PhoneTab[] {
  return sections
    .filter((section) => section.phone === "bar")
    .map((section) => ({ id: section.id, label: section.label, icon: section.icon ?? "" }));
}

export interface MoreSheetRow {
  id: AppSectionId;
  label: string;
  why: string;
}

/**
 * More-sheet rows in display order: Tables first (R0 promotes tables over
 * orders everywhere — Orders already has its tab), then the Assistant, then
 * Settings. The Settings blurb names Usage so the moved allowance panel
 * stays discoverable.
 */
export function moreSheetRows(sections: readonly AppSection[]): MoreSheetRow[] {
  return sections
    .filter((section) => section.phone === "more")
    .sort((a, b) => (a.moreRank ?? 0) - (b.moreRank ?? 0))
    .map((section) => ({ id: section.id, label: section.label, why: section.why ?? "" }));
}

/**
 * A pill's label. `libraryCount` is null while the count is not a fact yet —
 * the café map has not answered, or its read failed — so the tab keeps its
 * plain label instead of printing a number that is about to change.
 */
export function sectionTabLabel(section: AppSection, libraryCount: number | null): string {
  if (section.id === "library" && libraryCount !== null && libraryCount > 0) {
    return `${section.label} (${libraryCount})`;
  }
  return section.label;
}

/**
 * Which destination a screen belongs to. An open menu (and its item deep
 * link) lives under My menus: the sidebar should not go blank just because
 * the editor took the canvas.
 */
export function sectionForScreen(screen: AppScreen): AppSectionId {
  return screen === "editor" || screen === "item" ? "library" : screen;
}

/** Build the canonical path for an application screen. */
export function appRouteHref(route: AppRoute): string {
  switch (route.screen) {
    case "capture":
      return "/";
    case "library":
      return "/menus";
    case "orders":
      return "/orders";
    case "assistant":
      return "/assistant";
    case "tables":
      return "/tables";
    case "settings":
      return "/settings";
    case "editor": {
      const menuPath = `/menus/${encodeURIComponent(route.menuId)}`;
      return route.mode === "edit" ? menuPath : `${menuPath}/${route.mode}`;
    }
    case "item":
      return `/menus/${encodeURIComponent(route.menuId)}/items/${encodeURIComponent(route.itemId)}`;
  }
}

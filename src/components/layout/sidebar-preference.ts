/**
 * Where the sidebar's collapsed/expanded choice lives.
 *
 * The width itself is CSS (`globals.css`), driven by a `data-sidebar`
 * attribute on `<html>` that the boot script in `layout.tsx` sets before the
 * first paint. Doing it that way means a saved preference never flashes the
 * other width on load, and the sidebar renders identically on the server and
 * on the client — no hydration mismatch and no layout jump.
 *
 * Defaults are by viewport: a 72px rail until there is room for a 260px
 * column (xl / 1280px), the expanded column above that. An explicit choice
 * wins at every width and is remembered across sessions.
 */
export type SidebarMode = "expanded" | "rail";

export const SIDEBAR_MODE_ATTR = "data-sidebar";
export const SIDEBAR_STORAGE_KEY = "eateryo:sidebar";
/** Notifies the toggle when the applied mode changes outside React. */
export const SIDEBAR_CHANGE_EVENT = "eateryo:sidebar-change";
/** Width at which an un-chosen sidebar defaults to its expanded column. */
export const SIDEBAR_EXPANDED_MIN_WIDTH = 1280;

/** Narrow `localStorage` (or anything else) to a mode, or null when unset. */
export function parseSidebarMode(value: unknown): SidebarMode | null {
  return value === "expanded" || value === "rail" ? value : null;
}

/** What a viewport gets when the person has not expressed a preference. */
export function defaultSidebarMode(viewportWidth: number): SidebarMode {
  return viewportWidth >= SIDEBAR_EXPANDED_MIN_WIDTH ? "expanded" : "rail";
}

/**
 * The mode in force right now: the applied attribute (a saved choice, or a
 * toggle from this page) else the width's default. Reads the live document,
 * so it can back a `useSyncExternalStore` snapshot instead of an effect that
 * would set state after paint.
 */
export function currentSidebarMode(viewportWidth: number): SidebarMode {
  const applied = parseSidebarMode(
    document.documentElement.getAttribute(SIDEBAR_MODE_ATTR)
  );
  return applied ?? defaultSidebarMode(viewportWidth);
}

/** The stored choice, else the width's default. */
export function resolveSidebarMode(input: {
  stored: unknown;
  viewportWidth: number;
}): SidebarMode {
  return parseSidebarMode(input.stored) ?? defaultSidebarMode(input.viewportWidth);
}

/**
 * Runs in `<body>` before the shell is painted. Inline and synchronous on
 * purpose: a React effect would run after the first paint, which is exactly
 * the flash this avoids. Guarded because storage can throw in private modes.
 */
export const SIDEBAR_BOOT_SCRIPT =
  `try{var s=localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)});` +
  `if(s==="rail"||s==="expanded"){document.documentElement.setAttribute(` +
  `${JSON.stringify(SIDEBAR_MODE_ATTR)},s)}}catch(e){}`;

export function readSidebarMode(): SidebarMode | null {
  try {
    return parseSidebarMode(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeSidebarMode(mode: SidebarMode): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
  } catch {
    // A browser that refuses storage still gets the choice for this page.
  }
}

/** Apply a choice to the live document (the toggle's immediate effect). */
export function applySidebarMode(mode: SidebarMode): void {
  document.documentElement.setAttribute(SIDEBAR_MODE_ATTR, mode);
}

import type { MenuDocument } from "@/features/menu/schema";
import { routeMenuId, type AppRoute } from "@/features/navigation/routes";

/**
 * A new menu the shell opened before its first change. It lives in memory
 * only until the first edit persists it, so a URL naming it can outlive the
 * document: a refresh before anything changed must land back in the library
 * quietly, not accuse the menu of being deleted. The marker is per tab
 * (sessionStorage), because the in-memory document is too.
 */
const PENDING_NEW_MENU_KEY = "eateryo.pending-new-menu";

interface PendingNewMenuStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function pendingStore(store?: PendingNewMenuStore | null): PendingNewMenuStore | null {
  if (store !== undefined) return store;
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingNewMenu(id: string, store?: PendingNewMenuStore | null): void {
  pendingStore(store)?.setItem(PENDING_NEW_MENU_KEY, id);
}

export function isPendingNewMenu(id: string, store?: PendingNewMenuStore | null): boolean {
  return pendingStore(store)?.getItem(PENDING_NEW_MENU_KEY) === id;
}

/** Forget it once the first change lands (or the quiet landing consumes it). */
export function forgetPendingNewMenu(id: string, store?: PendingNewMenuStore | null): void {
  const active = pendingStore(store);
  if (active?.getItem(PENDING_NEW_MENU_KEY) === id) active.removeItem(PENDING_NEW_MENU_KEY);
}

/**
 * The document an editor screen may render: the one the URL names, or nothing.
 *
 * Leaving the editor for the library keeps the document in memory on purpose,
 * so mode changes and returns skip a read. The editor used to render whatever
 * document was in memory, which meant entering a *different* menu painted the
 * previous menu's rows, title and save status until its own copy arrived —
 * and an edit made in that window could land in the wrong record. Rendering
 * only the routed document turns that wait into the editor's own loading
 * state, while the cached copy still serves a return to the same menu.
 */
export function docForRoutedMenu(
  openDoc: MenuDocument | null,
  route: AppRoute
): MenuDocument | null {
  const menuId = routeMenuId(route);
  return openDoc && menuId !== null && openDoc.id === menuId ? openDoc : null;
}

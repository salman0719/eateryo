import type { MenuDocument } from "@/features/menu/schema";
import { routeMenuId, type AppRoute } from "@/features/navigation/routes";

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

/**
 * The editor's tab strip (menu-config redesign, step 2): which sub-tab of
 * the edit workspace is showing.
 *
 * Tab order is fixed: Settings & hours · Categories · Reorder · Preview ·
 * Add-on sets. Reorder and Preview are URL modes (`EditorMode`); the other
 * three are client state inside edit mode, so switching between them never
 * touches the URL and back/forward keeps working.
 *
 * Everything here is pure except the tiny per-menu persistence, which
 * follows `fold.ts`: a localStorage preference that never throws.
 */

import { hasAnyPrice } from "./menu-utils";
import type { MenuDocument } from "./schema";

/** The three sub-tabs inside edit mode. */
export type EditorSubTab = "settings" | "categories" | "addons";

export const EDITOR_SUB_TABS: readonly EditorSubTab[] = ["settings", "categories", "addons"];

export const EDITOR_SUB_TAB_LABELS: Record<EditorSubTab, string> = {
  settings: "Settings & hours",
  categories: "Categories",
  addons: "Add-on sets",
};

/**
 * Where the editor opens (the prototype's Viewing-as toggle becomes logic):
 * a menu with no categories — or categories with no dishes — has nothing to
 * arrange yet, so it lands on Settings & hours; anything else on Categories.
 */
export function defaultEditorSubTab(doc: Pick<MenuDocument, "categories">): EditorSubTab {
  if (doc.categories.length === 0) return "settings";
  const dishes = doc.categories.reduce((count, category) => count + category.items.length, 0);
  return dishes === 0 ? "settings" : "categories";
}

/** Badge numbers for the tab strip. */
export interface EditorTabCounts {
  /** Every dish in the menu — the Categories badge. */
  dishes: number;
  /** Dishes asking for a look: review notes, or no honest price the owner never accepted. */
  toCheck: number;
  /** Reusable add-on sets — the Add-on sets badge. */
  sets: number;
}

/** Count the tab badges from the live document (cheap: one pass). */
export function editorTabCounts(
  doc: Pick<MenuDocument, "categories" | "modifierTemplates">
): EditorTabCounts {
  let dishes = 0;
  let toCheck = 0;
  for (const category of doc.categories) {
    dishes += category.items.length;
    for (const item of category.items) {
      if (item.reviewNotes.length > 0 || (!hasAnyPrice(item) && !item.unpricedAccepted)) {
        toCheck += 1;
      }
    }
  }
  return { dishes, toCheck, sets: doc.modifierTemplates.length };
}

const STORAGE_PREFIX = "menu-editor-subtab:";

function storageKey(menuId: string): string {
  return STORAGE_PREFIX + menuId;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage access can throw (privacy mode); nothing is remembered then.
    return null;
  }
}

function isSubTab(value: unknown): value is EditorSubTab {
  return value === "settings" || value === "categories" || value === "addons";
}

/** The remembered sub-tab for a menu, or null when there is none. */
export function readEditorSubTab(menuId: string): EditorSubTab | null {
  const raw = storage()?.getItem(storageKey(menuId));
  return isSubTab(raw) ? raw : null;
}

/** Remember the sub-tab for a menu; never throws. */
export function writeEditorSubTab(menuId: string, tab: EditorSubTab): void {
  try {
    storage()?.setItem(storageKey(menuId), tab);
  } catch {
    // A browser with storage blocked simply opens on the entry rule.
  }
}

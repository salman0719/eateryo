/**
 * The Categories tab's selection model (menu-config redesign, step 14).
 *
 * The tab shows **one category and one dish at a time**: the tab row names
 * the category on the canvas and the inspector on the right edits the dish
 * that is selected. That is the whole model — there is no fold state here,
 * because a folded section is a thing this layout cannot express (nothing is
 * stacked to fold).
 *
 * Two rules keep it honest:
 *
 * - A selection is a *question about the document*, never a copy of it. Every
 *   read goes through `resolveSelection`, so a deleted dish, a deleted
 *   category, or a category the document no longer holds simply resolves to
 *   something that exists — the tab never points at nothing.
 * - The selection is remembered per menu (a tiny localStorage preference,
 *   like `editor-tabs.ts`), and a dish deep link seeds it. It is not a stored
 *   preference in the document itself: two devices may look at different
 *   dishes.
 */

import type { MenuDocument } from "./schema";

const STORAGE_PREFIX = "menu-editor-selection:";

/** The two ids the tab needs; null is "nothing selected". */
export interface EditorSelection {
  readonly categoryId: string | null;
  readonly itemId: string | null;
}

export const EMPTY_SELECTION: EditorSelection = { categoryId: null, itemId: null };

/** The slice of a document the selection is resolved against. */
type SelectionDoc = Pick<MenuDocument, "categories">;

/**
 * The nearest honest selection: the candidate category if it exists, else the
 * first one; the candidate dish if it lives in that category, else nothing
 * (the inspector closes rather than showing another category's dish).
 */
export function resolveSelection(
  doc: SelectionDoc,
  candidate?: EditorSelection | null
): EditorSelection {
  const categories = doc.categories;
  if (categories.length === 0) return EMPTY_SELECTION;
  const category =
    (candidate?.categoryId
      ? categories.find((entry) => entry.id === candidate.categoryId)
      : undefined) ?? categories[0];
  const item = candidate?.itemId
    ? category.items.find((entry) => entry.id === candidate.itemId)
    : undefined;
  return { categoryId: category.id, itemId: item?.id ?? null };
}

/** Show one category with no dish open (picking a tab is a category choice). */
export function selectCategory(doc: SelectionDoc, categoryId: string): EditorSelection {
  return resolveSelection(doc, { categoryId, itemId: null });
}

/** Show one dish: its own category comes with it. */
export function selectItem(doc: SelectionDoc, itemId: string): EditorSelection {
  const category = doc.categories.find((entry) =>
    entry.items.some((item) => item.id === itemId)
  );
  if (!category) return resolveSelection(doc, null);
  return { categoryId: category.id, itemId };
}

/**
 * The next dish inside one category, wrapping — the inspector's "Next dish"
 * step, so reviewing a section never means going back to the list.
 */
export function adjacentItemId(
  doc: SelectionDoc,
  categoryId: string,
  itemId: string | null,
  delta: 1 | -1
): string | null {
  const category = doc.categories.find((entry) => entry.id === categoryId);
  if (!category || category.items.length === 0) return null;
  const index = itemId ? category.items.findIndex((entry) => entry.id === itemId) : -1;
  if (index === -1) return category.items[0].id;
  const next = (index + delta + category.items.length) % category.items.length;
  return category.items[next].id;
}

// --- Persistence (tiny per-document preference) ----------------------------

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

function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Remembered selection for one document, or null when there is none. */
export function readSelection(menuId: string): EditorSelection | null {
  try {
    const raw = storage()?.getItem(storageKey(menuId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const categoryId = readId(record.categoryId);
    if (!categoryId) return null;
    return { categoryId, itemId: readId(record.itemId) };
  } catch {
    return null;
  }
}

/** Persist one document's selection; never throws. */
export function writeSelection(menuId: string, selection: EditorSelection): void {
  try {
    storage()?.setItem(
      storageKey(menuId),
      JSON.stringify({ categoryId: selection.categoryId, itemId: selection.itemId })
    );
  } catch {
    // A browser with storage blocked simply opens on the first category.
  }
}

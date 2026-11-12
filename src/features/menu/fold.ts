/**
 * Fold state for the menu editor: which sections and which dishes are open.
 *
 * Direction A of the editor layout work: a dish is a *row* by default and its
 * full form is the exception, while a category is a *section* that is open by
 * default. Those two defaults are what keep a forty-dish menu short — neither
 * is a stored preference, they are just the absence of an exception:
 *
 * - `closedCategoryIds` — categories the owner collapsed.
 * - `openItemIds` — dishes the owner opened.
 *
 * Everything is pure. Persistence is a tiny per-document preference in
 * localStorage (allowed by the stack rules) and never throws: a browser with
 * storage blocked simply opens with nothing remembered.
 */

const STORAGE_PREFIX = "menu-fold:";

/**
 * A menu can carry hundreds of dishes, and every folded id is only an id, so
 * this cap exists purely to stop a long-lived document growing the entry
 * without bound. Past it the oldest ids fall out; an id that is no longer in
 * the document never matters anyway.
 */
const MAX_IDS = 400;

export interface FoldState {
  /** Category ids the owner collapsed. Default: open. */
  readonly closedCategoryIds: readonly string[];
  /** Item ids the owner opened. Default: closed. */
  readonly openItemIds: readonly string[];
}

export const EMPTY_FOLD: FoldState = { closedCategoryIds: [], openItemIds: [] };

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

/** Strings only, in order, from whatever was in storage. */
function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function addId(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return [...ids];
  return [...ids, id].slice(-MAX_IDS);
}

function removeId(ids: readonly string[], id: string): string[] {
  return ids.filter((candidate) => candidate !== id);
}

// --- Questions -------------------------------------------------------------

/** A category is open unless it was collapsed. */
export function isCategoryOpen(state: FoldState, categoryId: string): boolean {
  return !state.closedCategoryIds.includes(categoryId);
}

/** A dish's form is closed unless it was opened. */
export function isItemOpen(state: FoldState, itemId: string): boolean {
  return state.openItemIds.includes(itemId);
}

// --- Changes ---------------------------------------------------------------

export function setCategoryOpen(state: FoldState, categoryId: string, open: boolean): FoldState {
  return {
    ...state,
    closedCategoryIds: open
      ? removeId(state.closedCategoryIds, categoryId)
      : addId(state.closedCategoryIds, categoryId),
  };
}

export function toggleCategory(state: FoldState, categoryId: string): FoldState {
  return setCategoryOpen(state, categoryId, !isCategoryOpen(state, categoryId));
}

export function setItemOpen(state: FoldState, itemId: string, open: boolean): FoldState {
  return {
    ...state,
    openItemIds: open ? addId(state.openItemIds, itemId) : removeId(state.openItemIds, itemId),
  };
}

export function toggleItem(state: FoldState, itemId: string): FoldState {
  return setItemOpen(state, itemId, !isItemOpen(state, itemId));
}

/** Expand all / collapse all for the given categories. */
export function setCategoriesOpen(
  state: FoldState,
  categoryIds: readonly string[],
  open: boolean
): FoldState {
  if (open) {
    return {
      ...state,
      closedCategoryIds: state.closedCategoryIds.filter((id) => !categoryIds.includes(id)),
    };
  }
  // Keep the order ids were already closed in, then add the rest.
  const alreadyClosed = [...state.closedCategoryIds];
  const additions = categoryIds.filter((id) => !alreadyClosed.includes(id));
  return { ...state, closedCategoryIds: [...alreadyClosed, ...additions].slice(-MAX_IDS) };
}

/** Open every dish (Expand all) or close them all (Collapse all). */
export function setItemsOpen(
  state: FoldState,
  itemIds: readonly string[],
  open: boolean
): FoldState {
  return { ...state, openItemIds: open ? itemIds.slice(-MAX_IDS) : [] };
}

/**
 * Open one dish *and* the category holding it, so revealing a dish is never
 * silent: a deep link, a search hit, or a freshly added item cannot land
 * inside a closed section.
 */
export function revealItem(state: FoldState, itemId: string, categoryId: string): FoldState {
  return setCategoryOpen(setItemOpen(state, itemId, true), categoryId, true);
}

// --- Persistence (tiny per-document preference) ----------------------------

/** Remembered fold state for one document; never throws. */
export function readFoldState(menuId: string): FoldState {
  try {
    const raw = storage()?.getItem(storageKey(menuId));
    if (!raw) return EMPTY_FOLD;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_FOLD;
    const record = parsed as Record<string, unknown>;
    return {
      closedCategoryIds: readIds(record.closedCategoryIds).slice(-MAX_IDS),
      openItemIds: readIds(record.openItemIds).slice(-MAX_IDS),
    };
  } catch {
    return EMPTY_FOLD;
  }
}

/** Persist one document's fold state; never throws. */
export function writeFoldState(menuId: string, state: FoldState): void {
  try {
    storage()?.setItem(
      storageKey(menuId),
      JSON.stringify({
        closedCategoryIds: state.closedCategoryIds,
        openItemIds: state.openItemIds,
      })
    );
  } catch {
    // Quota/privacy failures only lose the remembered shape, never an edit.
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_FOLD,
  isCategoryOpen,
  isItemOpen,
  readFoldState,
  revealItem,
  setCategoriesOpen,
  setCategoryOpen,
  setItemOpen,
  setItemsOpen,
  toggleCategory,
  toggleItem,
  writeFoldState,
} from "@/features/menu/fold";

/**
 * Direction A: a dish is a row until its form is asked for, and a category is
 * a section that is open until it is collapsed. These are the two defaults a
 * long menu rests on, so they are tested as behaviour rather than as fields.
 */

describe("fold defaults", () => {
  it("opens categories and closes dishes with nothing remembered", () => {
    expect(isCategoryOpen(EMPTY_FOLD, "breakfast")).toBe(true);
    expect(isItemOpen(EMPTY_FOLD, "espresso")).toBe(false);
  });
});

describe("toggling", () => {
  it("closes and reopens one category without touching the others", () => {
    const closed = toggleCategory(EMPTY_FOLD, "breakfast");
    expect(isCategoryOpen(closed, "breakfast")).toBe(false);
    expect(isCategoryOpen(closed, "drinks")).toBe(true);

    const reopened = toggleCategory(closed, "breakfast");
    expect(isCategoryOpen(reopened, "breakfast")).toBe(true);
    expect(reopened.closedCategoryIds).toEqual([]);
  });

  it("opens one dish and leaves its neighbours closed", () => {
    const opened = toggleItem(EMPTY_FOLD, "espresso");
    expect(isItemOpen(opened, "espresso")).toBe(true);
    expect(isItemOpen(opened, "latte")).toBe(false);

    expect(isItemOpen(toggleItem(opened, "espresso"), "espresso")).toBe(false);
  });

  it("is idempotent for an explicit open or close", () => {
    const once = setItemOpen(EMPTY_FOLD, "espresso", true);
    const twice = setItemOpen(once, "espresso", true);
    expect(twice.openItemIds).toEqual(["espresso"]);

    const closed = setCategoryOpen(EMPTY_FOLD, "breakfast", false);
    expect(setCategoryOpen(closed, "breakfast", false).closedCategoryIds).toEqual(["breakfast"]);
  });
});

describe("expand and collapse all", () => {
  it("collapses every named category and expands them again", () => {
    const allClosed = setCategoriesOpen(EMPTY_FOLD, ["breakfast", "drinks"], false);
    expect(isCategoryOpen(allClosed, "breakfast")).toBe(false);
    expect(isCategoryOpen(allClosed, "drinks")).toBe(false);
    // A category that was not named is untouched.
    expect(isCategoryOpen(allClosed, "sides")).toBe(true);

    const allOpen = setCategoriesOpen(allClosed, ["breakfast", "drinks"], true);
    expect(allOpen.closedCategoryIds).toEqual([]);
  });

  it("opens the dishes it is given and closes them all", () => {
    const allOpen = setItemsOpen(EMPTY_FOLD, ["espresso", "latte"], true);
    expect(isItemOpen(allOpen, "espresso")).toBe(true);
    expect(isItemOpen(allOpen, "latte")).toBe(true);

    expect(setItemsOpen(allOpen, ["espresso", "latte"], false).openItemIds).toEqual([]);
  });
});

describe("revealItem", () => {
  it("opens the dish and the category that holds it", () => {
    const closedSection = toggleCategory(EMPTY_FOLD, "breakfast");
    const revealed = revealItem(closedSection, "toast", "breakfast");
    expect(isItemOpen(revealed, "toast")).toBe(true);
    expect(isCategoryOpen(revealed, "breakfast")).toBe(true);
  });
});

describe("remembered shape", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips per document and forgets nothing else", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    expect(readFoldState("menu-1")).toEqual(EMPTY_FOLD);

    // A different section stays collapsed; revealing the dish opens the one
    // that holds it.
    const state = revealItem(toggleCategory(EMPTY_FOLD, "sides"), "latte", "drinks");
    writeFoldState("menu-1", state);
    expect(readFoldState("menu-1")).toEqual({
      closedCategoryIds: ["sides"],
      openItemIds: ["latte"],
    });
    // Scoped to its own menu, and an unknown menu starts from the defaults.
    expect(readFoldState("menu-2")).toEqual(EMPTY_FOLD);
  });

  it("starts unfolded when storage is blocked or unreadable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readFoldState("menu-1")).toEqual(EMPTY_FOLD);
    expect(() => writeFoldState("menu-1", EMPTY_FOLD)).not.toThrow();

    vi.unstubAllGlobals();
    // Node has no localStorage at all: still no throw, still the defaults.
    expect(readFoldState("menu-1")).toEqual(EMPTY_FOLD);
    expect(() => writeFoldState("menu-1", EMPTY_FOLD)).not.toThrow();
  });

  it("ignores stored values that are not a list of ids", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{not json",
      setItem: () => {},
    });
    expect(readFoldState("menu-1")).toEqual(EMPTY_FOLD);

    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ closedCategoryIds: ["a", 7, null], openItemIds: "nope" }),
      setItem: () => {},
    });
    expect(readFoldState("menu-1")).toEqual({ closedCategoryIds: ["a"], openItemIds: [] });
  });
});

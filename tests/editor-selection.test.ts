import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adjacentItemId,
  EMPTY_SELECTION,
  readSelection,
  resolveSelection,
  selectCategory,
  selectItem,
  writeSelection,
} from "../src/features/menu/editor-selection";
import { addCategory, addItem, createMenuDocument } from "../src/features/menu/menu-utils";

function setupMenu() {
  let doc = createMenuDocument({ title: "Café" });
  doc = addCategory(doc, { name: "Coffee" });
  doc = addCategory(doc, { name: "Food" });
  const [coffeeId, foodId] = doc.categories.map((c) => c.id);
  doc = addItem(doc, coffeeId, { name: "Espresso", price: 3 });
  doc = addItem(doc, coffeeId, { name: "Latte", price: 4 });
  doc = addItem(doc, foodId, { name: "Toast", price: 6 });
  return doc;
}

describe("resolveSelection", () => {
  it("opens the first category with no dish on an empty menu", () => {
    expect(resolveSelection(createMenuDocument())).toEqual(EMPTY_SELECTION);
  });

  it("opens the first category when nothing is remembered", () => {
    const doc = setupMenu();
    expect(resolveSelection(doc)).toEqual({ categoryId: doc.categories[0].id, itemId: null });
  });

  it("falls back to the first category when the remembered one is gone", () => {
    const doc = setupMenu();
    const selection = resolveSelection(doc, { categoryId: "deleted", itemId: null });
    expect(selection.categoryId).toBe(doc.categories[0].id);
  });

  it("closes the inspector when the remembered dish is gone", () => {
    const doc = setupMenu();
    const selection = resolveSelection(doc, {
      categoryId: doc.categories[0].id,
      itemId: "deleted-item",
    });
    expect(selection).toEqual({ categoryId: doc.categories[0].id, itemId: null });
  });

  it("refuses a dish that lives in another category", () => {
    const doc = setupMenu();
    const toast = doc.categories[1].items[0];
    const selection = resolveSelection(doc, {
      categoryId: doc.categories[0].id,
      itemId: toast.id,
    });
    expect(selection.itemId).toBeNull();
  });
});

describe("selectCategory / selectItem", () => {
  it("picking a category closes the inspector", () => {
    const doc = setupMenu();
    const latte = doc.categories[0].items[1];
    const withDish = selectItem(doc, latte.id);
    expect(withDish.itemId).toBe(latte.id);
    expect(selectCategory(doc, doc.categories[1].id)).toEqual({
      categoryId: doc.categories[1].id,
      itemId: null,
    });
  });

  it("picking a dish brings its own category", () => {
    const doc = setupMenu();
    const toast = doc.categories[1].items[0];
    expect(selectItem(doc, toast.id)).toEqual({
      categoryId: doc.categories[1].id,
      itemId: toast.id,
    });
  });

  it("an unknown dish falls back to the first category", () => {
    const doc = setupMenu();
    expect(selectItem(doc, "nope")).toEqual({
      categoryId: doc.categories[0].id,
      itemId: null,
    });
  });
});

describe("adjacentItemId", () => {
  it("steps forward and wraps inside the category", () => {
    const doc = setupMenu();
    const [espresso, latte] = doc.categories[0].items;
    expect(adjacentItemId(doc, doc.categories[0].id, espresso.id, 1)).toBe(latte.id);
    expect(adjacentItemId(doc, doc.categories[0].id, latte.id, 1)).toBe(espresso.id);
  });

  it("steps backward and wraps", () => {
    const doc = setupMenu();
    const [espresso, latte] = doc.categories[0].items;
    expect(adjacentItemId(doc, doc.categories[0].id, espresso.id, -1)).toBe(latte.id);
  });

  it("starts at the first dish when nothing is open, and says so in an empty one", () => {
    const doc = setupMenu();
    expect(adjacentItemId(doc, doc.categories[0].id, null, 1)).toBe(doc.categories[0].items[0].id);
    const empty = addCategory(doc, { name: "Desserts" });
    const desserts = empty.categories[empty.categories.length - 1];
    expect(adjacentItemId(empty, desserts.id, null, 1)).toBeNull();
  });
});

describe("selection persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the selection per menu", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    expect(readSelection("menu-1")).toBeNull();
    writeSelection("menu-1", { categoryId: "c1", itemId: "i1" });
    expect(readSelection("menu-1")).toEqual({ categoryId: "c1", itemId: "i1" });
    expect(readSelection("menu-2")).toBeNull();
  });

  it("ignores stored values that are not a selection", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ categoryId: "", itemId: "i1" }),
      setItem: () => {},
    });
    expect(readSelection("menu-1")).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => "not json", setItem: () => {} });
    expect(readSelection("menu-1")).toBeNull();
  });

  it("never throws without storage", () => {
    expect(readSelection("menu-1")).toBeNull();
    expect(() =>
      writeSelection("menu-1", { categoryId: "c1", itemId: null })
    ).not.toThrow();
  });
});

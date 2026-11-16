import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultEditorSubTab,
  editorTabCounts,
  readEditorSubTab,
  writeEditorSubTab,
} from "../src/features/menu/editor-tabs";
import { addItem, createMenuDocument } from "../src/features/menu/menu-utils";

describe("defaultEditorSubTab", () => {
  it("lands an empty menu on Settings & hours", () => {
    expect(defaultEditorSubTab(createMenuDocument())).toBe("settings");
  });

  it("lands categories-without-dishes on Settings & hours", () => {
    const doc = createMenuDocument();
    doc.categories.push({
      id: "c1",
      name: "Mains",
      sortOrder: 0,
      description: "",
      cover: null,
      items: [],
    });
    expect(defaultEditorSubTab(doc)).toBe("settings");
  });

  it("lands a menu with dishes on Categories", () => {
    let doc = createMenuDocument();
    doc.categories.push({
      id: "c1",
      name: "Mains",
      sortOrder: 0,
      description: "",
      cover: null,
      items: [],
    });
    doc = addItem(doc, "c1", { name: "Soup", price: 5 });
    expect(defaultEditorSubTab(doc)).toBe("categories");
  });
});

describe("editorTabCounts", () => {
  it("counts dishes, sets, and dishes asking for a look", () => {
    let doc = createMenuDocument();
    doc.categories.push({
      id: "c1",
      name: "Mains",
      sortOrder: 0,
      description: "",
      cover: null,
      items: [],
    });
    // Priced and clean: counted, not flagged.
    doc = addItem(doc, "c1", { name: "Soup", price: 5 });
    // No price and never accepted: flagged.
    doc = addItem(doc, "c1", { name: "Mystery", price: null });
    // Owner accepted the missing price: not flagged.
    doc = addItem(doc, "c1", { name: "Market fish", price: null, unpricedAccepted: true });
    // Review notes always ask for a look, even with a price.
    doc = addItem(doc, "c1", { name: "Stew", price: 9, reviewNotes: ["check spelling"] });
    expect(editorTabCounts(doc)).toEqual({ dishes: 4, toCheck: 2, sets: 0 });
  });
});

describe("editor sub-tab persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the sub-tab per menu", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    expect(readEditorSubTab("menu-1")).toBeNull();
    writeEditorSubTab("menu-1", "addons");
    expect(readEditorSubTab("menu-1")).toBe("addons");
    expect(readEditorSubTab("menu-2")).toBeNull();
  });

  it("ignores stored values that are not sub-tabs", () => {
    vi.stubGlobal("localStorage", { getItem: () => "reorder", setItem: () => {} });
    expect(readEditorSubTab("menu-1")).toBeNull();
  });

  it("never throws without storage", () => {
    expect(readEditorSubTab("menu-1")).toBeNull();
    expect(() => writeEditorSubTab("menu-1", "settings")).not.toThrow();
  });
});

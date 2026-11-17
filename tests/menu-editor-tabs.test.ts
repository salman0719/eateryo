import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultEditorSubTab,
  editorTabCounts,
  readEditorSubTab,
  readReorderCategory,
  readReorderScope,
  writeEditorSubTab,
  writeReorderCategory,
  writeReorderScope,
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

describe("reorder scope persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  }

  it("remembers the scope and category per menu", () => {
    stubStorage();
    expect(readReorderScope("menu-1")).toBeNull();
    expect(readReorderCategory("menu-1")).toBeNull();
    writeReorderScope("menu-1", "items");
    writeReorderCategory("menu-1", "c9");
    expect(readReorderScope("menu-1")).toBe("items");
    expect(readReorderCategory("menu-1")).toBe("c9");
    // A second menu is unaffected.
    expect(readReorderScope("menu-2")).toBeNull();
    expect(readReorderCategory("menu-2")).toBeNull();
  });

  it("ignores stored values that are not a scope", () => {
    vi.stubGlobal("localStorage", { getItem: () => "reorder", setItem: () => {} });
    expect(readReorderScope("menu-1")).toBeNull();
  });

  it("ignores a blank stored category", () => {
    vi.stubGlobal("localStorage", { getItem: () => "", setItem: () => {} });
    expect(readReorderCategory("menu-1")).toBeNull();
  });

  it("never throws without storage", () => {
    expect(readReorderScope("menu-1")).toBeNull();
    expect(readReorderCategory("menu-1")).toBeNull();
    expect(() => writeReorderScope("menu-1", "items")).not.toThrow();
    expect(() => writeReorderCategory("menu-1", "c9")).not.toThrow();
  });
});

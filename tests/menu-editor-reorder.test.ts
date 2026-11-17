import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuEditor } from "../src/components/menu-editor/menu-editor";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";
import { createMenuDocument } from "../src/features/menu/menu-utils";
import type { MenuDocument } from "../src/features/menu/schema";

const noop = () => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubReorderTab(docId: string, scope: string, categoryId?: string) {
  const store = new Map<string, string>([[`menu-editor-reorder-scope:${docId}`, scope]]);
  if (categoryId) store.set(`menu-editor-reorder-category:${docId}`, categoryId);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
}

function renderReorder(doc: MenuDocument): string {
  return renderToStaticMarkup(
    createElement(MenuEditor, {
      doc,
      mode: "reorder",
      onModeChange: noop,
      onChange: noop,
      saveState: { kind: "saved", message: "Saved" },
      syncMode: "local",
      imageUrl: null,
      onExportJson: noop,
      onExportCsv: noop,
      onImportFile: noop,
      importError: null,
      onDeleteMenu: noop,
    })
  );
}

/**
 * Step 11 pins: the Reorder tab owns a scope switch, and every row in
 * both scopes is a draggable grip row that keeps its steppers.
 */
describe("menu-editor reorder tab", () => {
  it("lists draggable category rows with steppers in Categories scope", () => {
    const doc = createSampleMenuDocument();
    const html = renderReorder(doc);
    expect(html).toContain('aria-label="Reorder scope"');
    expect(html).toContain(">Categories<");
    expect(html).toContain(">Items<");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("⋮⋮");
    expect(html.match(/draggable="true"/g)).toHaveLength(doc.categories.length);
    // Steppers stay on every row as the touch and keyboard path.
    expect(html).toContain("Move Espresso &amp; Coffee up");
  });

  it("lists the picked category's dishes in Items scope", () => {
    const doc = createSampleMenuDocument();
    const first = doc.categories[0];
    stubReorderTab(doc.id, "items", first.id);
    const html = renderReorder(doc);
    expect(html).toContain("Espresso &amp; Coffee");
    expect(html.match(/draggable="true"/g)).toHaveLength(first.items.length);
    expect(html).toContain(`Move ${first.items[0].name} up`);
  });

  it("shows an empty-state line for a dish-less category", () => {
    const doc = createMenuDocument({ title: "Empty" });
    doc.categories.push({
      id: "c1",
      name: "Mains",
      sortOrder: 0,
      description: "",
      cover: null,
      items: [],
    });
    stubReorderTab(doc.id, "items", "c1");
    const html = renderReorder(doc);
    expect(html).toContain("No dishes in Mains yet");
  });
});

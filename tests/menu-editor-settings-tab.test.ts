import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuEditor } from "../src/components/menu-editor/menu-editor";
import { addItem, createMenuDocument } from "../src/features/menu/menu-utils";

const noop = () => {};

const baseProps = {
  doc: createMenuDocument(),
  mode: "edit" as const,
  onModeChange: noop,
  onChange: noop,
  saveState: { kind: "saved" as const, message: "Saved" },
  syncMode: "local" as const,
  imageUrl: null,
  onExportJson: noop,
  onExportCsv: noop,
  onImportFile: noop,
  importError: null,
  onDeleteMenu: noop,
  onBack: noop,
};

function docWithDupes() {
  let doc = createMenuDocument();
  for (const [id, name] of [
    ["c1", "Mains"],
    ["c2", "Starters"],
  ] as const) {
    doc.categories.push({
      id,
      name,
      sortOrder: 0,
      description: "",
      cover: null,
      items: [],
    });
  }
  doc = addItem(doc, "c1", { name: "Soup", price: 5 });
  doc = addItem(doc, "c2", { name: "soup", price: null });
  return doc;
}

/**
 * Step 10 pins: the Settings tab owns identity, hours, data, and danger
 * controls; the Categories tab owns the working rows and the reviews that
 * point at them. Neither tab renders the other's blocks.
 */
describe("menu-editor settings tab recomposition", () => {
  it("lands an empty menu on Settings with identity and data controls", () => {
    const html = renderToStaticMarkup(createElement(MenuEditor, baseProps));
    expect(html).toContain("Settings &amp; hours");
    expect(html).toContain("Menu title");
    expect(html).toContain("Currency");
    expect(html).toContain("Add pages");
    expect(html).toContain("Export JSON");
    expect(html).toContain("Export CSV");
    expect(html).toContain("Import JSON");
    expect(html).toContain("Delete menu");
    expect(html).not.toContain("Possible duplicates");
  });

  it("keeps the Categories tab to rows, pills, and the duplicate review", () => {
    const html = renderToStaticMarkup(
      createElement(MenuEditor, { ...baseProps, doc: docWithDupes() })
    );
    expect(html).toContain("Possible duplicates");
    expect(html).toContain("Search items, descriptions, or categories");
    expect(html).not.toContain("Menu title");
    expect(html).not.toContain("Export JSON");
    expect(html).not.toContain("Delete menu");
  });
});

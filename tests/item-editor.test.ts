import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ItemEditor } from "../src/components/menu-editor/item-editor";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";

const noop = () => {};

/**
 * Step 5 pins: the shut row says name + shape (never the description), the
 * open row takes the accent wash, and availability is a segmented group of
 * three pressed states.
 */
function renderRow(itemIndex: number, open: boolean): string {
  const doc = createSampleMenuDocument();
  const category = doc.categories[0];
  return renderToStaticMarkup(
    createElement(ItemEditor, {
      doc,
      categoryId: category.id,
      isRouteTarget: false,
      item: category.items[itemIndex],
      categories: doc.categories.map((c) => ({ id: c.id, name: c.name })),
      actions: {
        change: noop,
        toggleOpen: noop,
        toggleSelected: noop,
        delete: noop,
        attachImage: noop,
      },
      labelVocabulary: [],
      duplicate: false,
      open,
      selected: false,
      canUploadImage: false,
    })
  );
}

describe("item row compaction", () => {
  it("shows the shape but not the description on a shut row", () => {
    const html = renderRow(0, false);
    expect(html).toContain("Espresso");
    expect(html).toContain("2 sizes");
    expect(html).not.toContain("Double shot, syrupy and bright.");
    expect(html).not.toContain("bg-accent-50");
  });

  it("washes the open row with the accent and a left rule", () => {
    const html = renderRow(0, true);
    expect(html).toContain("bg-accent-50");
    expect(html).toContain("border-l-accent-700");
    expect(html).toContain("Double shot, syrupy and bright.");
  });

  it("renders availability as a pressed-state segment group", () => {
    const html = renderRow(0, true);
    expect(html).toContain('role="group"');
    expect(html).toContain("Unknown");
    expect(html).toContain("Available");
    expect(html).toContain("Unavailable");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

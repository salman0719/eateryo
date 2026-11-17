import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ItemInspector } from "../src/components/menu-editor/item-inspector";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";

const noop = () => {};

function render(itemIndex: number): string {
  const doc = createSampleMenuDocument();
  const category = doc.categories[0];
  return renderToStaticMarkup(
    createElement(ItemInspector, {
      doc,
      categoryId: category.id,
      categoryName: category.name,
      item: category.items[itemIndex],
      categories: doc.categories.map((c) => ({ id: c.id, name: c.name })),
      position: itemIndex + 1,
      count: category.items.length,
      canUploadImage: false,
      onChange: noop,
      onAttachImage: noop,
      onDuplicate: noop,
      onDelete: noop,
      onDone: noop,
      onNext: noop,
    })
  );
}

/**
 * The inspector is the old unfolded form, in its own column: identity first,
 * then the fields the diner page shows, then Duplicate / Delete / Next / Done.
 */
describe("ItemInspector", () => {
  it("names the dish and where it sits in the category", () => {
    const html = render(0);
    expect(html).toContain("Espresso");
    expect(html).toContain("dish 1 of");
    expect(html).toContain("Item name");
    expect(html).toContain("Description");
  });

  it("opens on the values the row does not show", () => {
    const html = render(0);
    expect(html).toContain("Double shot, syrupy and bright.");
    expect(html).toContain("Variants / sizes");
    expect(html).toContain("Options / add-ons");
  });

  it("keeps availability a pressed-state segment group", () => {
    const html = render(0);
    expect(html).toContain('role="group"');
    expect(html).toContain("Unknown");
    expect(html).toContain("Available");
    expect(html).toContain("Unavailable");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("shows dietary chips with their meaning and an edit entry", () => {
    const html = render(1);
    expect(html).toContain("vegan");
    expect(html).toContain('title="No animal products."');
    expect(html).toContain("Edit labels");
  });

  it("carries its own actions, including a way out and a way on", () => {
    const html = render(0);
    for (const label of ["Duplicate", "Delete", "Next dish", "Done"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-label="Close the dish editor"');
  });
});

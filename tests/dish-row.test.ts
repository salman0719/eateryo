import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DishRow } from "../src/components/menu-editor/dish-row";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";
import type { DishRowActions } from "../src/components/menu-editor/dish-row";

const actions: DishRowActions = { select: () => {}, toggleSelected: () => {} };

/**
 * The row is the whole dish at a glance: name, shape, price and the flags
 * that need attention. Fields live in the inspector, so the row never grows
 * a form of its own.
 */
function renderRow(
  itemIndex: number,
  state: { selected?: boolean; duplicate?: boolean } = {}
): string {
  const doc = createSampleMenuDocument();
  const item = doc.categories[0].items[itemIndex];
  return renderToStaticMarkup(
    createElement(DishRow, {
      item,
      currency: doc.currency,
      selected: state.selected ?? false,
      bulkSelected: false,
      duplicate: state.duplicate ?? false,
      actions,
    })
  );
}

describe("DishRow", () => {
  it("shows the name, shape and price but never the description", () => {
    const html = renderRow(0);
    expect(html).toContain("Espresso");
    expect(html).toContain("2 sizes");
    expect(html).toContain("USD 2.50");
    expect(html).not.toContain("Double shot, syrupy and bright.");
  });

  it("is a selector, not a disclosure", () => {
    const html = renderRow(0);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("menu-item-panel");
    expect(html).toContain("Select Espresso for bulk move");
  });

  it("marks the open dish with the left rule and aria-current", () => {
    const html = renderRow(1, { selected: true });
    expect(html).toContain("border-l-accent-700");
    expect(html).toContain('aria-current="true"');
    expect(renderRow(1)).not.toContain('aria-current="true"');
  });

  it("flags a duplicate without hiding the name", () => {
    const html = renderRow(1, { duplicate: true });
    expect(html).toContain("Possible duplicate");
    expect(html).toContain("Oat Milk Latte");
  });
});

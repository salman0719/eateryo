import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderMenuSection } from "../src/components/order/order-menu";
import type { MenuCategory } from "../src/features/menu/schema";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";

const noop = () => {};

function section(category: MenuCategory): string {
  return renderToStaticMarkup(
    createElement(OrderMenuSection, {
      category,
      currency: "USD",
      variantChoice: {},
      onVariantChange: noop,
      onAdd: noop,
    })
  );
}

/**
 * The row's controls sit on the right edge, as one cluster: a dish with sizes
 * shows the picker first and Add beside it, not stacked under the dish name.
 * Pinned because "Align Add to the right" is a layout decision the CSS could
 * quietly lose (a stray `justify-start`, a wrapped row) without any test
 * noticing.
 */
describe("diner dish row controls", () => {
  it("right-aligns the size picker and Add, picker first", () => {
    const doc = createSampleMenuDocument();
    const category = doc.categories.find((candidate) =>
      candidate.items.some((item) => item.variants.length > 0)
    );
    expect(category).toBeDefined();

    const html = section(category!);
    expect(html).toContain("mt-2 flex flex-wrap items-center justify-end gap-2");

    const picker = html.indexOf("<select");
    const add = html.indexOf("rounded-full bg-accent-700 px-3.5 py-1.5 text-xs font-semibold");
    expect(picker).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(picker);
  });
});

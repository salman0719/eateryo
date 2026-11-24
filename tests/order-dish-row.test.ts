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
 * The row's add control sits in its own right-hand column, vertically centred:
 * a dish with sizes keeps the picker in the content flow and the circular
 * plus isolated on the edge, so text, price and the picker never shift it.
 * Pinned because right-edge alignment is a layout decision the CSS could
 * quietly lose without any test noticing.
 */
describe("diner dish row controls", () => {
  it("isolates the plus in its own column, picker in the content flow", () => {
    const doc = createSampleMenuDocument();
    const category = doc.categories.find((candidate) =>
      candidate.items.some((item) => item.variants.length > 0)
    );
    expect(category).toBeDefined();

    const html = section(category!);
    expect(html).toContain("relative inline-flex flex-none items-center self-stretch");
    expect(html).toContain("grid h-8 w-8 place-items-center rounded-full bg-accent-700");
    expect(html).toContain('aria-label="Add ');

    const picker = html.indexOf("<select");
    const add = html.indexOf('aria-label="Add ');
    expect(picker).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(picker);
  });
});

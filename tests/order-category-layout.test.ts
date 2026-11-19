import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategorySections, OrderMenuSection } from "../src/components/order/order-menu";
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

function list(): string {
  return renderToStaticMarkup(
    createElement(CategorySections, null, [
      createElement("div", { key: "a" }, "A"),
      createElement("div", { key: "b" }, "B"),
    ])
  );
}

/**
 * On a phone the menu is the page: categories run edge to edge as one
 * continuous sheet, with the list supplying the hairlines between them. From
 * `sm` up each category is the inset rounded card the desktop page was
 * designed around. Pinned because both halves live in class strings that a
 * later "tidy up" could collapse into one width.
 */
describe("category layout", () => {
  it("drops the section's own card below sm and restores it above", () => {
    const doc = createSampleMenuDocument();
    const html = section(doc.categories[0]!);

    expect(html).toContain(
      "overflow-hidden bg-surface-base sm:rounded-2xl sm:border sm:border-line-200"
    );
    // The old every-width card would inset the list inside the page padding.
    expect(html).not.toContain("rounded-2xl border border-line-200 bg-surface-base");
  });

  it("bleeds the list to the viewport and separates categories with a gutter", () => {
    const html = list();

    // A hairline vanished next to a cover photo, so the mobile sheet uses a
    // short bare gutter between categories instead.
    expect(html).toContain(
      "-mx-4 flex min-w-0 flex-col divide-y-8 divide-surface-100 border-y border-line-200 bg-surface-base"
    );
    expect(html).toContain("sm:mx-0 sm:gap-4 sm:divide-y-0 sm:border-0 sm:bg-transparent");
  });
});

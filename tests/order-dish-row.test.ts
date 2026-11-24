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
 * The dish carousel card keeps the circular plus in the card foot beside the
 * price, with the size picker above it in the card body. Pinned because the
 * snap rail could quietly regress to rows without any test noticing.
 */
describe("diner dish carousel controls", () => {
  it("renders a snap rail of cards with picker above the price plus foot", () => {
    const doc = createSampleMenuDocument();
    const category = doc.categories.find((candidate) =>
      candidate.items.some((item) => item.variants.length > 0)
    );
    expect(category).toBeDefined();

    const html = section(category!);
    expect(html).toContain("snap-x snap-mandatory");
    expect(html).toContain("w-[200px] shrink-0 snap-start");
    expect(html).toContain("grid h-8 w-8 place-items-center rounded-full bg-accent-700");
    expect(html).toContain('aria-label="Add ');

    const picker = html.indexOf("<select");
    const add = html.indexOf('aria-label="Add ');
    expect(picker).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(picker);
  });
});

/**
 * Photo-less dishes: the pattern tile keeps the media slot when the category
 * has at least one photo; a category with no photos at all goes text-first
 * with no media boxes. Pinned because an empty grey slot reads as broken.
 */
describe("diner dish carousel missing photos", () => {
  it("goes text-first when the category has no photos", () => {
    const doc = createSampleMenuDocument();
    const category = doc.categories.find((candidate) => candidate.items.length > 0);
    expect(category).toBeDefined();

    const html = section(category!);
    expect(html).not.toContain("h-28");
    expect(html).toContain("dish-text-first");
    expect(html).not.toContain("dish-photo-fallback");
  });

  it("shows the pattern tile for photo-less dishes in a photographed category", () => {
    const doc = createSampleMenuDocument();
    const category = doc.categories.find((candidate) => candidate.items.length > 1);
    expect(category).toBeDefined();

    const mixed: MenuCategory = {
      ...category!,
      items: category!.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              image: {
                url: "https://example.test/dish.jpg",
                key: "test-dish",
                width: 800,
                height: 600,
                thumb: null,
              },
            }
          : item
      ),
    };

    const html = section(mixed);
    expect(html).toContain("dish-photo-fallback");
    expect(html).toContain("h-28");
    expect(html).not.toContain("dish-text-first");
  });
});

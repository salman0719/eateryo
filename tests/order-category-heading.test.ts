import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderMenuSection } from "../src/components/order/order-menu";
import type { MenuCategory } from "../src/features/menu/schema";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";

const noop = () => {};

const COVER_URL = "https://cdn.example/dish-cover/display.jpg";

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

function coveredCategory(): MenuCategory {
  const doc = createSampleMenuDocument();
  const category = doc.categories[0];
  return {
    ...category,
    description: "Small plates to open.",
    cover: { url: COVER_URL, key: "dish-cover/display", width: 1024, height: 640, thumb: null },
  };
}

/**
 * Step 13 pins treatment C (SPEC §5.4): a set cover renders one uniform
 * 72px banner with the overlaid title and the description below it — no
 * cover degrades to today's band, and each of cover and description is
 * optional on its own.
 */
describe("order category heading", () => {
  it("renders the 72px banner with overlaid title for a covered category", () => {
    const html = section(coveredCategory());
    expect(html).toContain("h-[72px]");
    expect(html).toContain(COVER_URL);
    expect(html).toContain("object-cover");
    expect(html).toContain("Small plates to open.");
    // The band treatment is gone where the banner is.
    expect(html).not.toContain("uppercase");
  });

  it("renders today's band plus the description without a cover", () => {
    const category = { ...coveredCategory(), cover: null };
    const html = section(category);
    expect(html).toContain("uppercase");
    expect(html).toContain("Small plates to open.");
    expect(html).not.toContain("object-cover");
    expect(html).not.toContain(COVER_URL);
  });

  it("renders the bare band when neither cover nor description is set", () => {
    const category = { ...coveredCategory(), cover: null, description: "" };
    const html = section(category);
    expect(html).toContain("uppercase");
    expect(html).not.toContain("Small plates to open.");
    expect(html).not.toContain("object-cover");
  });
});

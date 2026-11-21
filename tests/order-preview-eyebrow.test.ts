import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderPagePreview } from "@/components/order/order-page-preview";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

/**
 * The preview is what the owner judges the table page by, so it wears the
 * same cover as the live landing: the café name, the table underneath, and
 * the menu title as the subline — never a stitched "Name · Table 1" line.
 */
describe("OrderPagePreview cover", () => {
  function render(): string {
    return renderToStaticMarkup(
      createElement(OrderPagePreview, {
        doc: createSampleMenuDocument(),
        restaurantName: "Corner Café",
      })
    );
  }

  it("shares the diner cover: café name, table, and menu title", () => {
    const html = render();
    expect(html).toContain("Corner Café");
    expect(html).toContain("Table 1");
    expect(html).not.toContain("Corner Café · Table 1");
  });
});

/**
 * Brand assets on the preview cover: a logo replaces the initial tile and a
 * cover photo replaces the gradient band — the same header a table card
 * opens, so the owner judges the page by this preview.
 */
describe("OrderPagePreview brand assets", () => {
  const LOGO = {
    url: "https://cdn.example/brand-logo-display.webp",
    key: "brand-logo",
    width: 512,
    height: 512,
    thumb: {
      url: "https://cdn.example/brand-logo-thumb.webp",
      key: "brand-logo-thumb",
      width: 256,
      height: 256,
    },
  };
  const COVER = {
    url: "https://cdn.example/brand-cover-display.webp",
    key: "brand-cover",
    width: 1600,
    height: 900,
    thumb: null,
  };

  function renderBrand(logo: typeof LOGO | null, cover: typeof COVER | null): string {
    return renderToStaticMarkup(
      createElement(OrderPagePreview, {
        doc: createSampleMenuDocument(),
        restaurantName: "Corner Café",
        restaurantLogo: logo,
        restaurantCover: cover,
      })
    );
  }

  it("shows the logo tile and cover photo when set", () => {
    const html = renderBrand(LOGO, COVER);
    expect(html).toContain("https://cdn.example/brand-logo-thumb.webp");
    expect(html).toContain("https://cdn.example/brand-cover-display.webp");
  });

  it("falls back to the initial tile and gradient band without assets", () => {
    const html = renderBrand(null, null);
    expect(html).not.toContain("cdn.example/brand-");
    expect(html).toContain("linear-gradient");
  });
});

/**
 * Step 13 owner preview check: the preview renders the real diner
 * `OrderMenuSection`, so a set category cover shows the same 72px banner
 * a table card opens — the owner judges the page by this preview.
 */
describe("OrderPagePreview category banner", () => {
  it("shows a covered category's banner from the draft", () => {
    const doc = createSampleMenuDocument();
    const category = doc.categories[0];
    const covered = {
      ...doc,
      categories: [
        {
          ...category,
          description: "Small plates to open.",
          cover: {
            url: "https://cdn.example/dish-cover/display.jpg",
            key: "dish-cover/display",
            width: 1024,
            height: 640,
            thumb: null,
          },
        },
        ...doc.categories.slice(1),
      ],
    };
    const html = renderToStaticMarkup(
      createElement(OrderPagePreview, {
        doc: covered,
        restaurantName: "Corner Café",
      })
    );
    expect(html).toContain("h-[72px]");
    expect(html).toContain("https://cdn.example/dish-cover/display.jpg");
    expect(html).toContain("Small plates to open.");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderPagePreview } from "@/components/order/order-page-preview";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

/**
 * The PhoneFrame owner preview showed "Your café · Table 1" in the old
 * warning colour while every live diner page had already moved that
 * eyebrow to the brand accent. The preview is what the owner judges the
 * table page by, so it must wear the same colour.
 */
describe("OrderPagePreview eyebrow", () => {
  function render(): string {
    return renderToStaticMarkup(
      createElement(OrderPagePreview, {
        doc: createSampleMenuDocument(),
        restaurantName: "Corner Café",
      })
    );
  }

  it("names the café and table in the brand accent, not the warning colour", () => {
    const html = render();
    expect(html).toContain("Corner Café · Table 1");
    expect(html).toContain("text-accent-700 uppercase");
    expect(html).not.toContain("text-warning-800 uppercase");
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

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

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandCard } from "@/components/settings/brand-card";

/**
 * The deferred Settings preview: a Preview button beside the slots that
 * opens the diner header in a phone frame, so the settings page stays
 * compact. The dialog itself is client state and shut by default.
 */
describe("BrandCard preview", () => {
  function render(): string {
    return renderToStaticMarkup(
      createElement(BrandCard, {
        restaurant: { id: "r1", name: "Corner Café", role: "owner", logo: null, cover: null },
        canManage: true,
        onChanged: () => {},
      })
    );
  }

  it("offers a preview of the diner header", () => {
    const html = render();
    expect(html).toContain("Preview");
    expect(html).toContain("table card opens it");
  });

  it("keeps the preview shut on first paint", () => {
    const html = render();
    expect(html).not.toContain("Diner header preview");
  });
});

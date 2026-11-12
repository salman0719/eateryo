import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderShell } from "@/components/order/order-menu";

/**
 * The diner shell used to carry its own "E" tile beside a text "Eateryo":
 * a second brand that missed the drawn identity. It renders the shared
 * lockup now, so the table page, the owner preview and the confirmation
 * all name the product the same way the app does.
 */
describe("OrderShell brand", () => {
  function render(): string {
    return renderToStaticMarkup(
      createElement(OrderShell, {
        tableLabel: "3",
        children: createElement("p", null, "menu"),
      })
    );
  }

  it("renders the shared lockup, not a letter tile", () => {
    const html = render();
    expect(html).toContain('aria-label="Eateryo"');
    expect(html).toContain("Order from your table");
    expect(html).not.toContain(">E<");
    expect(html).not.toContain(">Eateryo<");
  });

  it("keeps the table pill beside it", () => {
    expect(render()).toContain("Table 3");
  });
});

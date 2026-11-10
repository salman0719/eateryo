import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/layout/app-sidebar";

/**
 * The rail's centring is a `justify-content` only — `src/app/globals.css`:
 * `html[data-sidebar="rail"] .app-sidebar-brand { justify-content: center }`.
 * `justify-content` does nothing on a block, so the element carrying that
 * class has to be the flex container. When the brand was extracted into
 * `BrandLockup`, `flex` moved onto the inner element and the tile drifted to
 * the padding edge while the nav icons beneath stayed centred. Nothing failed:
 * the flaw only shows in the collapsed rail, which no test renders.
 *
 * Server rendering is enough here. There is no browser harness in this repo
 * (no Playwright/Puppeteer/jsdom), so what this pins is the structure the CSS
 * contract depends on; the pixels are still a manual check at 1280px.
 */
function renderSidebar(): string {
  return renderToStaticMarkup(
    createElement(AppSidebar, {
      sections: [],
      activeSection: null,
      sessionPending: true,
      signedIn: false,
      email: null,
      onNavigate: () => {},
      onSignOut: () => {},
    })
  );
}

describe("AppSidebar brand wrapper", () => {
  it("is the flex container the rail's centring rule acts on", () => {
    const match = renderSidebar().match(/<div class="([^"]*\bapp-sidebar-brand\b[^"]*)"/);
    expect(match).not.toBeNull();

    const classes = (match?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(classes).toContain("flex");
    // A column would centre on the cross axis instead, which is not the rule.
    expect(classes).not.toContain("flex-col");
  });

  it("still renders the lockup inside it", () => {
    expect(renderSidebar()).toContain("Eateryo");
  });
});

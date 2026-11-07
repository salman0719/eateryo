import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { appSections } from "@/features/navigation/routes";
import { OrderMonitorProvider } from "@/features/orders/monitor";

/**
 * The sidebar's My menus count is only trustworthy once the account's menu
 * list has been read. Until then it holds a placeholder, so an owner never
 * sees a browser-only number that grows a moment later. Static markup is
 * enough: the count and its placeholder are what must not swap meanings.
 */

function render(options: { menusPending: boolean; count: number }) {
  const sections = appSections({
    signedIn: true,
    assistantEnabled: false,
    menuCount: options.count,
  });
  return renderToStaticMarkup(
    createElement(
      OrderMonitorProvider,
      { userId: null },
      createElement(AppSidebar, {
        sections,
        activeSection: "capture",
        sessionPending: false,
        signedIn: true,
        email: "owner@example.com",
        onNavigate: () => {},
        onSignOut: () => {},
        menusPending: options.menusPending,
      })
    )
  );
}

describe("AppSidebar My menus count", () => {
  it("shows a placeholder and says it is loading while the account read is pending", () => {
    const markup = render({ menusPending: true, count: 0 });
    expect(markup).toContain("loading your menus");
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toMatch(/\d+ menus/);
  });

  it("never shows a partial local count that the account read will grow", () => {
    const markup = render({ menusPending: true, count: 2 });
    expect(markup).not.toContain("2 menus");
    expect(markup).toContain("loading your menus");
  });

  it("shows the real count once the read has settled", () => {
    const markup = render({ menusPending: false, count: 4 });
    expect(markup).toContain("4 menus");
    expect(markup).not.toContain("loading your menus");
    expect(markup).not.toContain("animate-pulse");
  });
});

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { availableSections } from "@/features/navigation/routes";
import { OrderMonitorProvider } from "@/features/orders/monitor";
import { CAPABILITIES } from "@/features/tenancy/permissions";

/**
 * The sidebar's My menus count is only trustworthy once the account's menu
 * list has been read. Until then it holds a placeholder, so an owner never
 * sees a browser-only number that grows a moment later. Static markup is
 * enough: the count and its placeholder are what must not swap meanings.
 */

function render(options: {
  menusPending: boolean;
  count: number;
  sessionPending?: boolean;
  /** The membership read behind a known session is still in flight. */
  sectionsPending?: boolean;
}) {
  const sessionPending = options.sessionPending ?? false;
  const sectionsPending = options.sectionsPending ?? sessionPending;
  const sections = sessionPending
    ? []
    : availableSections({
        signedIn: true,
        can: (capability) => CAPABILITIES.includes(capability),
        assistantEnabled: false,
        hasWorkingSet: true,
      }).map((section) =>
        // The shell fills in the library's number, exactly as home-screen does.
        section.id === "library" ? { ...section, count: options.count } : section
      );
  return renderToStaticMarkup(
    createElement(
      // The provider requires children in its type; createElement passes them
      // as arguments, so the wrapper's type drops that one prop.
      OrderMonitorProvider as ComponentType<{
        userId: string | null;
        restaurantId: string | null;
      }>,
      { userId: null, restaurantId: null },
      createElement(AppSidebar, {
        sections,
        activeSection: "capture",
        sessionPending,
        sectionsPending,
        signedIn: !sessionPending,
        email: sessionPending ? null : "owner@example.com",
        onNavigate: () => {},
        onSignOut: () => {},
        onHome: () => {},
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

describe("AppSidebar destinations while the answer is still coming", () => {
  it("holds the nav's shape instead of an empty column", () => {
    const markup = render({ menusPending: false, count: 0, sessionPending: true });
    expect(markup).toContain("Loading navigation");
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/min-h-\[40px\]/g)?.length).toBe(5);
  });

  it("announces the wait once, not once per placeholder row", () => {
    const markup = render({ menusPending: false, count: 0, sessionPending: true });
    expect(markup.match(/Loading navigation/g)).toHaveLength(1);
    expect(markup).not.toContain(">Capture<");
  });

  /**
   * The window this column regressed in: the session has answered, so the
   * column is mounted, but `can()` refuses until the membership read lands —
   * so `sections` is empty while the nav is in the shell's `!navReady` state.
   * Without the placeholder the column rendered its brand, account and
   * collapse button around nothing, then filled.
   */
  it("holds the rows while the membership read is still in flight", () => {
    const markup = render({
      menusPending: false,
      count: 0,
      sessionPending: false,
      sectionsPending: true,
    });
    expect(markup).toContain("Loading navigation");
    expect(markup.match(/min-h-\[40px\]/g)?.length).toBe(5);
    expect(markup).not.toContain(">Capture<");
    // The session did answer, so the account block is real, not a skeleton.
    expect(markup).toContain("owner@example.com");
  });

  it("draws the rows once the answer lands", () => {
    const markup = render({ menusPending: false, count: 0, sectionsPending: false });
    expect(markup).not.toContain("Loading navigation");
    expect(markup).toContain(">Capture<");
  });
});

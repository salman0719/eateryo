import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShellFrame, type ShellFrameProps } from "@/components/layout/shell-frame";
import { APP_SECTIONS } from "@/features/navigation/routes";

/**
 * The shell frame used to be the return value of the 4k-line `HomeScreen`,
 * which meant the chrome could only be exercised by mounting the whole app
 * state machine. It is its own component now: the frame takes the answers it
 * needs (who is signed in, which column shows, which sections are available)
 * and renders the chrome around whatever page it is handed.
 */
function render(overrides: Partial<ShellFrameProps> = {}, child: ReactNode = null): string {
  // The frame requires children in its type; createElement passes them as
  // arguments, so the cast drops that one prop (same pattern as the sidebar
  // and diner-shell tests).
  return renderToStaticMarkup(
    createElement(
      ShellFrame as ComponentType<Omit<ShellFrameProps, "children"> & { children?: ReactNode }>,
      {
        dialog: null,
        screen: "capture",
        wideMeasure: false,
        signedIn: true,
        sessionPending: false,
        email: "owner@example.com",
        userId: "user-1",
        restaurantId: "cafe-1",
        monitorPending: false,
        showColumn: true,
        sidebar: {
          sections: APP_SECTIONS.map((section) => ({ ...section })),
          ready: true,
          outline: null,
          outlineKey: "",
          onOutlineSelect: () => {},
          launch: null,
          menusPending: false,
        },
        workspaces: [],
        activeWorkspace: null,
        onSwitchWorkspace: () => {},
        phone: {
          ready: true,
          tabs: [
            { id: "capture", label: "Capture" },
            { id: "library", label: "My menus" },
            { id: "orders", label: "Orders" },
          ],
          moreRows: [{ id: "tables", label: "Tables", why: "QR cards per table" }],
          moreOpen: false,
          onToggleMore: () => {},
          onCloseMore: () => {},
          screenInMore: false,
          canGetStarted: false,
          launchHint: "",
        },
        onNavigate: () => {},
        onHome: () => {},
        onSignOut: () => {},
        onOpenOrders: () => {},
        ...overrides,
      },
      child
    )
  );
}

describe("ShellFrame", () => {
  it("renders the destinations and the page in the content column", () => {
    const html = render({}, createElement("p", null, "page body"));
    expect(html).toContain(">Capture<");
    expect(html).toContain("page body");
    expect(html).toContain("Eateryo — free while it lasts");
  });

  it("keeps the column off for a visitor and carries the brand row instead", () => {
    const html = render({
      signedIn: false,
      showColumn: false,
      sidebar: {
        sections: APP_SECTIONS.filter((section) => section.id === "capture").map((section) => ({
          ...section,
        })),
        ready: true,
        outline: null,
        outlineKey: "",
        onOutlineSelect: () => {},
        launch: null,
        menusPending: false,
      },
    });
    // The column is an `aside`; the brand lockup inside it shares a class
    // name (`app-sidebar-mark`), so the element is what must be absent.
    expect(html).not.toContain("<aside");
    expect(html).toContain('aria-label="Eateryo"');
    // Signed out there is no phone navigation to get lost in.
    expect(html).not.toContain('aria-label="Sections"');
  });

  it("draws the phone bar and the More sheet trigger once the nav is ready", () => {
    const html = render();
    expect(html).toContain('aria-label="Sections"');
    expect(html).toContain("More");
  });
});

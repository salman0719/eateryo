import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  availableSections,
  moreSheetRows,
  phoneTabs,
  type SectionAccess,
} from "@/features/navigation/routes";
import { CAPABILITIES } from "@/features/tenancy/permissions";

/** Every capability, as an owner holds them. */
function ownerSections(overrides: Partial<SectionAccess> = {}) {
  return availableSections({
    signedIn: true,
    can: (capability) => CAPABILITIES.includes(capability),
    assistantEnabled: false,
    ...overrides,
  });
}

/**
 * R0.6 — regression guards for the R0 phone-nav decisions. There is no
 * browser harness in this repo (verified: no Playwright/Puppeteer/jsdom), so
 * layout at 390px is still a manual check; what these pin is the structure
 * that must not silently regress: Orders keeps its tab-bar home for the
 * monitor badge, Tables leads the More sheet, and the Settings blurb keeps
 * naming Usage so the moved panel stays discoverable.
 */

const sessionState = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: sessionState.user ? { user: sessionState.user } : null,
      isPending: false,
    }),
  },
}));

import { UsagePanel } from "@/components/settings/usage-panel";

describe("phoneTabs", () => {
  it("pins Capture, My menus, and Orders in that order", () => {
    expect(phoneTabs(ownerSections()).map((tab) => tab.id)).toEqual([
      "capture",
      "library",
      "orders",
    ]);
  });

  it("keeps Tables out of the bar — it lives in the More sheet", () => {
    expect(phoneTabs(ownerSections()).map((tab) => tab.id)).not.toContain("tables");
  });
});

describe("moreSheetRows", () => {
  it("leads with Tables so tables are promoted over orders everywhere", () => {
    expect(moreSheetRows(ownerSections())[0]?.id).toBe("tables");
    expect(moreSheetRows(ownerSections({ assistantEnabled: true }))[0]?.id).toBe("tables");
  });

  it("ends with Settings and names Usage in its blurb", () => {
    const rows = moreSheetRows(ownerSections());
    expect(rows[rows.length - 1]).toMatchObject({ id: "settings" });
    expect(rows[rows.length - 1]?.why).toContain("Usage");
  });

  it("never shows the Assistant signed out, whatever the flag says", () => {
    for (const assistantEnabled of [false, true]) {
      const rows = moreSheetRows(ownerSections({ signedIn: false, assistantEnabled }));
      expect(rows).toEqual([]);
    }
  });

  it("leaves a signed-out visitor with no tab bar at all", () => {
    // Signed out the shell is a single screen: Capture. A leftover draft is
    // resumed from its banner, so there is no My menus tab to offer.
    expect(phoneTabs(ownerSections({ signedIn: false }))).toEqual([
      { id: "capture", label: "Capture" },
    ]);
  });

  it("hides the Assistant from signed-in accounts while the flag is off", () => {
    const rows = moreSheetRows(ownerSections({ assistantEnabled: false }));
    expect(rows.map((row) => row.id)).not.toContain("assistant");
  });

  it("shows the Assistant to signed-in accounts once the flag is on", () => {
    const rows = moreSheetRows(ownerSections({ assistantEnabled: true }));
    expect(rows.map((row) => row.id)).toContain("assistant");
  });
});

describe("UsagePanel signed-out gate", () => {
  it("renders nothing without a session", () => {
    sessionState.user = null;
    expect(renderToStaticMarkup(createElement(UsagePanel, { restaurantId: "cafe-1" }))).toBe("");
  });
});

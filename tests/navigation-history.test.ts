import { describe, expect, it } from "vitest";

import { historyWriteFor } from "@/features/navigation/history";

/**
 * Navigation writes the URL before it changes the visible screen, so this
 * decision is the whole contract with the browser: when to add a step, when
 * to overwrite the current one, and when to touch nothing at all.
 */
describe("historyWriteFor", () => {
  it("pushes a new destination", () => {
    expect(historyWriteFor({ currentHref: "/menus", nextHref: "/orders", replace: false })).toBe(
      "push"
    );
  });

  it("replaces instead of pushing when the caller asks", () => {
    expect(
      historyWriteFor({ currentHref: "/menus/m-1/publish", nextHref: "/", replace: true })
    ).toBe("replace");
  });

  it("records nothing when the URL already matches", () => {
    expect(
      historyWriteFor({ currentHref: "/menus/m-1", nextHref: "/menus/m-1", replace: false })
    ).toBe("none");
    // Even a replacement has nothing to overwrite.
    expect(
      historyWriteFor({ currentHref: "/menus/m-1", nextHref: "/menus/m-1", replace: true })
    ).toBe("none");
  });

  it("compares the full href, so a query or a different menu is a real move", () => {
    expect(
      historyWriteFor({ currentHref: "/menus/m-1", nextHref: "/menus/m-1?tab=2", replace: false })
    ).toBe("push");
    expect(
      historyWriteFor({ currentHref: "/menus/m-1", nextHref: "/menus/m-2", replace: false })
    ).toBe("push");
  });
});

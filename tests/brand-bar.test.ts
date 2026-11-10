import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandBar } from "@/components/layout/brand-bar";
import { shellColumnVisible } from "@/features/navigation/routes";

function render(props: { signedIn: boolean; sessionPending: boolean }) {
  return renderToStaticMarkup(createElement(BrandBar, props));
}

/**
 * The phone brand row carries the only signed-out sign-in path below `sm` —
 * the sidebar is desktop-only and the More sheet is signed-in only — so these
 * pin the three session states, and in particular that an unanswered session
 * is never rendered as one.
 */
describe("BrandBar", () => {
  it("names the brand in every session state", () => {
    for (const props of [
      { signedIn: true, sessionPending: false },
      { signedIn: false, sessionPending: false },
      { signedIn: false, sessionPending: true },
    ]) {
      expect(render(props)).toContain("Eateryo");
    }
  });

  it("offers the one sign-in path when the visitor is signed out", () => {
    const html = render({ signedIn: false, sessionPending: false });
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Sign in");
  });

  it("claims nothing while the session is unanswered", () => {
    const html = render({ signedIn: false, sessionPending: true });
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain("Sign in");
  });

  it("does not offer sign-in to an account that is already in", () => {
    const html = render({ signedIn: true, sessionPending: false });
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain("Sign in");
  });
});

/**
 * The other half of the same decision: the row is the brand surface wherever
 * the column is gone. A visitor who has nothing in the library used to get a
 * column holding one "Capture" row, which read as a broken menu.
 */
describe("shellColumnVisible", () => {
  it("keeps the column for a signed-in account", () => {
    expect(shellColumnVisible({ sessionState: "signed-in", hasWorkingSet: false })).toBe(true);
  });

  it("drops it for a settled visitor with nothing to show", () => {
    expect(shellColumnVisible({ sessionState: "signed-out", hasWorkingSet: false })).toBe(false);
  });

  it("keeps it for a visitor with drafts, because My menus is a destination", () => {
    expect(shellColumnVisible({ sessionState: "signed-out", hasWorkingSet: true })).toBe(true);
  });

  it("keeps it while the session is unanswered", () => {
    expect(shellColumnVisible({ sessionState: "unknown", hasWorkingSet: false })).toBe(true);
  });
});

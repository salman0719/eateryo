import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandBar } from "@/components/layout/brand-bar";
import { BrandLockup } from "@/components/ui/brand";
import { shellColumnVisible } from "@/features/navigation/routes";

function render(props: { signedIn: boolean; sessionPending: boolean; onLibrary?: () => void }) {
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

  it("carries My menus while a signed-out browser holds a draft", () => {
    const html = render({ signedIn: false, sessionPending: false, onLibrary: () => {} });
    expect(html).toContain("My menus");
  });

  it("shows no library path when the signed-out browser is empty", () => {
    const html = render({ signedIn: false, sessionPending: false });
    expect(html).not.toContain("My menus");
  });
});

/**
 * Clicking the brand goes home. Inside the shell that is a client-side
 * navigation (a button, so open work survives); on a content page it is a
 * plain link to `/`. Without a destination the lockup stays decoration — it
 * must not become a control that goes nowhere.
 */
describe("BrandLockup destination", () => {
  it("is a button when the shell hands it a client-side destination", () => {
    const html = renderToStaticMarkup(
      createElement(BrandLockup, { onSelect: () => {}, tagline: "Home" })
    );
    expect(html).toContain("<button");
    expect(html).toContain('title="Eateryo home"');
    expect(html).not.toContain("<a ");
  });

  it("is a link to the home route on content pages", () => {
    const html = renderToStaticMarkup(createElement(BrandLockup, { href: "/" }));
    expect(html).toContain('href="/"');
    expect(html).toContain('title="Eateryo home"');
  });

  it("stays plain when no destination is given", () => {
    const html = renderToStaticMarkup(createElement(BrandLockup, {}));
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });
});

/**
 * The other half of the same decision: the row is the brand surface wherever
 * the column is gone. A visitor who has nothing in the library used to get a
 * column holding one "Capture" row, which read as a broken menu.
 */
describe("shellColumnVisible", () => {
  it("keeps the column for a signed-in account", () => {
    expect(shellColumnVisible({ sessionState: "signed-in" })).toBe(true);
  });

  it("never shows it to a settled visitor, drafts or not", () => {
    expect(shellColumnVisible({ sessionState: "signed-out" })).toBe(false);
  });

  it("hides it while the session is unanswered", () => {
    expect(shellColumnVisible({ sessionState: "unknown" })).toBe(false);
  });
});

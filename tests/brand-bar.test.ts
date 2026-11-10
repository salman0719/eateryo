import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandBar } from "@/components/layout/brand-bar";

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

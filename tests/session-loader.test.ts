import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionLoader } from "@/components/layout/session-loader";
import { SESSION_HINT_ATTR } from "@/features/session/session-hint";

/**
 * The returning account's wait. Two halves are load-bearing and neither is
 * visible from the component alone: the frame must stay mounted underneath
 * (the reads that end the wait live above it, so replacing the shell would
 * restart them), and visibility must come from CSS and the boot script's
 * attribute — a render-decided loader is the one that never showed.
 */
describe("SessionLoader", () => {
  const html = renderToStaticMarkup(createElement(SessionLoader));

  it("announces one wait, with a sentence for a screen reader", () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading your account");
  });

  it("carries the wordmark and three decorative dots", () => {
    expect(html).toContain('aria-label="Eateryo"');
    expect(html.match(/session-loader-dot/g)).toHaveLength(3);
  });

  it("covers the viewport instead of sitting inside the flow", () => {
    expect(html).toContain("fixed inset-0");
  });
});

describe("session loader visibility", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("is hidden unless the boot script said a session may exist", () => {
    // Unset must read as "no loader": a blocked script or a refused write
    // shows the visitor's frame, never a spinner nobody can leave.
    expect(css).toMatch(/\.session-loader\s*\{\s*display:\s*none;/);
    expect(css).toContain(`html[${SESSION_HINT_ATTR}="hinted"] .session-loader`);
  });

  it("stops its dots for reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.session-loader-dot/);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaptureStepRail, type CaptureStop } from "@/components/upload/capture-step-rail";

function render(current: CaptureStop, reachable: CaptureStop[]): string {
  return renderToStaticMarkup(
    createElement(CaptureStepRail, {
      current,
      reachable: new Set(reachable),
      onSelect: () => {},
    })
  );
}

describe("CaptureStepRail", () => {
  it("names the three stops, with no stop of its own for extraction", () => {
    const html = render("capture", ["capture"]);
    expect(html).toContain("Upload &amp; extract");
    expect(html).toContain("Review");
    expect(html).toContain("Publish");
    expect(html).not.toMatch(/>\s*Extract\s*</);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Menu photo to order page"');
  });

  it("draws one connector between each pair of stops", () => {
    const html = render("capture", ["capture"]);
    expect(html.match(/h-px/g)).toHaveLength(2);
  });

  it("marks exactly one stop current", () => {
    const html = render("review", ["capture", "review"]);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).not.toContain("aria-selected");
    const beforeSelected = html.slice(0, html.indexOf('aria-current="step"'));
    expect(beforeSelected).toContain("Upload &amp; extract");
  });

  it("only opens the stops the owner has reached", () => {
    const html = render("capture", ["capture"]);
    // The two stops ahead are shown but not usable.
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    const reached = render("review", ["capture", "review", "publish"]);
    expect(reached).not.toContain('disabled=""');
  });

  it("shows a check for a finished stop instead of its number", () => {
    const html = render("review", ["capture", "review"]);
    expect(html).toContain("✓");
  });
});

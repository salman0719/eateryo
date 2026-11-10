import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/layout/app-sidebar";

/**
 * The rail's centring is a `justify-content` only — `src/app/globals.css`:
 * `html[data-sidebar="rail"] .app-sidebar-brand { justify-content: center }`.
 * `justify-content` does nothing on a block, so the element carrying that
 * class has to be the flex container. When the brand was extracted into
 * `BrandLockup`, `flex` moved onto the inner element and the tile drifted to
 * the padding edge while the nav icons beneath stayed centred. Nothing failed:
 * the flaw only shows in the collapsed rail, which no test renders.
 *
 * Server rendering is enough here. There is no browser harness in this repo
 * (no Playwright/Puppeteer/jsdom), so what this pins is the structure the CSS
 * contract depends on; the pixels are still a manual check at 1280px.
 */
function renderSidebar(): string {
  return renderToStaticMarkup(
    createElement(AppSidebar, {
      sections: [],
      activeSection: null,
      sessionPending: true,
      signedIn: false,
      email: null,
      onNavigate: () => {},
      onSignOut: () => {},
    })
  );
}

describe("AppSidebar brand wrapper", () => {
  it("is the flex container the rail's centring rule acts on", () => {
    const match = renderSidebar().match(/<div class="([^"]*\bapp-sidebar-brand\b[^"]*)"/);
    expect(match).not.toBeNull();

    const classes = (match?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(classes).toContain("flex");
    // A column would centre on the cross axis instead, which is not the rule.
    expect(classes).not.toContain("flex-col");
  });

  it("still renders the lockup inside it", () => {
    expect(renderSidebar()).toContain("Eateryo");
  });
});

/**
 * The other half of that wrapper's geometry. The rail shows the 32px tile
 * alone; the column adds two label lines (20 + 16), so an unpinned wrapper
 * hands the whole nav a 4px vertical jump every time the mode changes — while
 * the width is still gliding, which is what made it read as a flick.
 *
 * No markup can express this: the mode is an attribute on `<html>`, put there
 * by the boot script. So the guard reads the stylesheet — as declarations, not
 * as text. Comments are stripped first: matching the raw file let a
 * commented-out `min-height` satisfy the check, so the first version of this
 * guard passed on the very regression it exists for.
 */
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

const BRAND_RULE = /\.app-sidebar-brand\s*\{([^}]*)\}/g;

/** The first `.app-sidebar-brand` body in a block. `match` drops captures on a
 * global regex, and `matchAll` needs one, so both callers go through `matchAll`. */
function brandBody(source: string): string | undefined {
  return [...source.matchAll(BRAND_RULE)][0]?.[1];
}

/** The body of the first at-rule whose prelude contains `head`, by brace depth. */
function atRuleBody(source: string, head: string): string | null {
  const at = source.indexOf(head);
  const open = at < 0 ? -1 : source.indexOf("{", at);
  if (open < 0) return null;

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** The `name: value` declarations in a rule body, last one winning. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return out;
}

/** A length as pixels, so `68px` and `4.25rem` are the same claim. */
function toPixels(value: string | undefined): number | null {
  const match = /^([\d.]+)(rem|px)$/.exec(value?.trim() ?? "");
  if (!match) return null;
  return match[2] === "rem" ? Number(match[1]) * 16 : Number(match[1]);
}

describe("brand wrapper height", () => {
  it("is pinned from sm up, so only the width changes between modes", () => {
    const block = atRuleBody(css, "@media (min-width: 640px)");
    expect(block).not.toBeNull();

    const body = block ? brandBody(block) : undefined;
    expect(body).toBeDefined();

    // `py-4` (32px) + the expanded lockup's two lines (20 + 16) = 68px.
    expect(toPixels(declarations(body ?? "")["min-height"])).toBeGreaterThanOrEqual(68);
  });

  it("never takes a fixed height that would clip the column's label", () => {
    const found = [...css.matchAll(BRAND_RULE)];
    expect(found.length).toBeGreaterThan(0);
    for (const rule of found) {
      // `min-height` is the fix; a bare `height` is not.
      expect(declarations(rule[1])).not.toHaveProperty("height");
    }
  });
});

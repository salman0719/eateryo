import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emailIconUrl, emailLogoMark } from "@/lib/email-layout";
import { themeColor } from "@/lib/theme/tokens";

/**
 * Two surfaces cannot read a CSS variable — the app icon is a file and email
 * clients strip variables — so both are generated from `src/app/theme.css` by
 * `scripts/build-theme-tokens.mjs`, which is run by hand when the theme
 * changes. These guards fail when the committed output is stale (a forgotten
 * `npm run theme:tokens`), catch a hand edit, and keep the email layout from
 * typing a colour of its own again.
 */
const script = fileURLToPath(new URL("../scripts/build-theme-tokens.mjs", import.meta.url));
const emailLayout = readFileSync(new URL("../src/lib/email-layout.ts", import.meta.url), "utf8");

describe("generated theme tokens", () => {
  it("match theme.css and the icon on disk", () => {
    // `--check` exits non-zero and names the stale files; it writes nothing.
    expect(() =>
      execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" })
    ).not.toThrow();
  }, 20_000);

  it("resolve every role to a value an email client can render", () => {
    expect(themeColor("accent-700")).toMatch(/^#[0-9a-f]{6}$/);
    expect(themeColor("on-accent")).toBe("#ffffff");
    expect(themeColor("scrim")).toMatch(/^rgba\(0, 0, 0, 0\.35\)$/);
    // The warning ramp is the gold one, not the retired lemon.
    expect(themeColor("warning-50")).toBe("#fffae5");
  });

  it("leave no palette literal in the email layout", () => {
    expect(emailLayout).not.toMatch(/#[0-9a-f]{6}/i);
    expect(emailLayout).toContain('themeColor("accent-700")');
  });

  it("link the app icon from an absolute, versioned URL with alt text", () => {
    // Word-engine Outlook renders no linked SVG, and Gmail rasterises it — so
    // the mark is one <img>, never an embedded <svg>, and the name travels as
    // the alt text and the line beneath it.
    const html = emailLogoMark("https://eateryo.test/api/auth/verify?token=abc");
    expect(html).not.toContain("<svg");
    expect(html).toContain('alt="Eateryo"');
    expect(html).toContain('src="https://eateryo.test/icon.svg?v=');
    expect(html).toContain('width="48"');

    // Only the origin survives: an email link cannot be relative, and the
    // action URL's own host is the one the recipient is about to visit.
    expect(emailIconUrl("https://eateryo.test/invitations/token-1")).toMatch(
      /^https:\/\/eateryo\.test\/icon\.svg\?v=[0-9a-f]{8}$/
    );
    // The revision is a cache key for the palette: same theme, same URL.
    expect(emailIconUrl("https://a.test/x").split("icon.svg")[1]).toBe(
      emailIconUrl("https://b.test/y").split("icon.svg")[1]
    );
  });
});

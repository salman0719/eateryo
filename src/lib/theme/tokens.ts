import { THEME_TOKENS } from "./theme-tokens";

/** A role token name, as the keys of the generated map. */
export type ThemeToken = keyof typeof THEME_TOKENS;

/**
 * A role's colour, resolved to CSS an SVG file or an email client can render.
 *
 * The values are generated from `src/app/theme.css` by
 * `scripts/build-theme-tokens.mjs`, so these are not a second palette: they are
 * that palette, read back in a syntax the two surfaces outside the app can use.
 * `tests/theme-tokens.test.ts` fails if the generated copy drifts from the theme.
 */
export function themeColor(role: ThemeToken): string {
  return THEME_TOKENS[role];
}

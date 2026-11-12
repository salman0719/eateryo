/**
 * The brand lockup, in one place.
 *
 * Concept 7, "The Hidden Eat": there is no separate mark for the name, because
 * the name already says "eat" — the first three letters carry the accent and
 * the last four the ink, so the colour break is the identity. The artwork is
 * drawn paths, not a font, so it renders the same in the app, in print and at
 * any size.
 *
 * Every colour here is a role token, so a palette change re-colours the brand
 * without touching this file. The 72px rail has no room for the wordmark, so
 * there it shows the app-icon tile instead — the same drawn "eat", generated
 * into `src/app/icon.svg` by `scripts/build-theme-tokens.mjs`; the CSS swap
 * lives in `globals.css` (`.app-sidebar-mark`).
 */
import type { ReactNode } from "react";

/** `eat` — the food word, and the product. */
function EatGlyph(): ReactNode {
  return (
    <>
      <path d="M44 52A22 22 0 1 0 36.1 68.9" />
      <path d="M22 52H43" />
      <g transform="translate(56 0)">
        <circle cx="22" cy="52" r="22" />
        <path d="M44 30V74" />
      </g>
      <g transform="translate(112 0)">
        <path d="M9 16V64Q9 74 19 74" />
        <path d="M0 30H20" />
      </g>
    </>
  );
}

/** `eryo` — the rest of the name. */
function RestGlyph(): ReactNode {
  return (
    <>
      <g transform="translate(144 0)">
        <path d="M44 52A22 22 0 1 0 36.1 68.9" />
        <path d="M22 52H43" />
      </g>
      <g transform="translate(200 0)">
        <path d="M4.5 30V74" />
        <path d="M4.5 48Q4.5 30 24 30" />
      </g>
      <g transform="translate(238 0)">
        <path d="M2 30L20.5 62" />
        <path d="M31 30L10 94" />
      </g>
      <g transform="translate(282 0)">
        <circle cx="22" cy="52" r="22" />
      </g>
    </>
  );
}

export function BrandLockup({
  tagline = null,
  truncate = false,
  labelClassName = "",
  className = "",
  href = null,
  onSelect = null,
}: {
  /** The second line. Omit it for the wordmark alone. */
  tagline?: string | null;
  /** Clip the tagline instead of letting it set the lockup's width. */
  truncate?: boolean;
  /**
   * Home destination for the lockup. One of the two makes the brand a real
   * control instead of decoration: `href` for pages outside the app shell
   * (a plain link home), `onSelect` for surfaces inside it (client-side
   * navigation that keeps in-memory state instead of reloading).
   */
  href?: string | null;
  onSelect?: (() => void) | null;
  /**
   * Classes on the wordmark block. The sidebar passes `app-sidebar-label`, the
   * rule that swaps the wordmark for the app-icon tile once the column is a
   * 72px rail.
   */
  labelClassName?: string;
  className?: string;
}) {
  const line = truncate ? "block truncate" : "block";
  const inner = (
    <>
      {/* Only the rail shows this tile; see `.app-sidebar-mark` in globals.css.
          It carries the app icon, so the name in the wordmark would be said
          twice wherever the column has room for both. */}
      <svg aria-hidden="true" viewBox="0 0 112 112" className="app-sidebar-mark h-8 w-8 shrink-0">
        <rect width="112" height="112" rx="24" className="fill-accent-700" />
        <g
          transform="translate(18 26) scale(0.576)"
          className="stroke-on-accent"
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <EatGlyph />
        </g>
      </svg>
      <span className={`min-w-0 ${labelClassName}`}>
        <svg
          role="img"
          aria-label="Eateryo"
          viewBox="-6 10 342 92"
          className="block h-[18px] w-auto"
        >
          <g strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <g className="stroke-accent-700">
              <EatGlyph />
            </g>
            <g className="stroke-ink-900">
              <RestGlyph />
            </g>
          </g>
        </svg>
        {tagline ? <span className={`${line} mt-0.5 text-xs text-ink-500`}>{tagline}</span> : null}
      </span>
    </>
  );
  const frame = `flex items-center gap-2.5 ${className}`;
  // The lockup is the way home everywhere it appears, so it is a real control
  // wherever a destination is given: a link on content pages, a button inside
  // the shell (which navigates client-side and keeps open work). Its name
  // comes from the wordmark inside, so neither wrapper repeats it.
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} title="Eateryo home" className={frame}>
        {inner}
      </button>
    );
  }
  if (href) {
    return (
      <a href={href} title="Eateryo home" className={frame}>
        {inner}
      </a>
    );
  }
  return <div className={frame}>{inner}</div>;
}

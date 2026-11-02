import type { ReactNode, SVGProps } from "react";

/**
 * Hand-drawn icon set — one module, one geometry, no icon dependency.
 *
 * Every glyph is drawn on a 24 unit grid with strokes rather than filled
 * paths, so they all share the same weight, cap and join, scale cleanly at any
 * `size`, and take their colour from `currentColor` (no per-icon colour props).
 *
 * Icons here are decoration: the control that carries one always has its own
 * label or `aria-label`, so each glyph is `aria-hidden` and skipped by the
 * keyboard by default.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox"> & {
  /** Rendered edge length in px. Defaults to 16. */
  size?: number;
};

function Glyph({
  size = 16,
  className = "",
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className || undefined}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Disclosure, closed. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6.5 9.5 12 15 17.5 9.5" />
    </Glyph>
  );
}

/** Disclosure, open. */
export function ChevronUpIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6.5 14.5 12 9 17.5 14.5" />
    </Glyph>
  );
}

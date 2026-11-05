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

/** Capture: a camera body with one lens. */
export function CameraIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 8.5h3l1.6-2.2h5.8l1.6 2.2h3v9.5h-15z" />
      <circle cx="12" cy="13.2" r="3.1" />
    </Glyph>
  );
}

/** My menus: a closed book. */
export function BookIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.5 4.5h8.5A2.5 2.5 0 0 1 16.5 7v12.5H8A2.5 2.5 0 0 1 5.5 17z" />
      <path d="M5.5 17a2.5 2.5 0 0 1 2.5-2.5h8.5" />
    </Glyph>
  );
}

/** Orders: a till receipt. */
export function ReceiptIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6.5 3.5h11v17l-2.75-1.8L12 20.5l-2.75-1.8L6.5 20.5z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </Glyph>
  );
}

/** Assistant: a four-point spark. */
export function SparkleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5l1.7 4.9 4.8 1.7-4.8 1.7L12 16.7l-1.7-4.9L5.5 10.1l4.8-1.7z" />
    </Glyph>
  );
}

/** Tables: a floor plan on a grid. */
export function GridIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 10v10" />
    </Glyph>
  );
}

/** Settings: two sliders. */
export function SlidersIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 7.5h9M17 7.5h2.5M4.5 16.5h2.5M10.5 16.5h9" />
      <circle cx="15" cy="7.5" r="2" />
      <circle cx="8.5" cy="16.5" r="2" />
    </Glyph>
  );
}

/** Sidebar toggle: a two-pane frame with a pointing chevron. */
export function PanelLeftIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15M16 9.5l-3 2.5 3 2.5" />
    </Glyph>
  );
}

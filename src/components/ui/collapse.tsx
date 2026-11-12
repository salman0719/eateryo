"use client";

/**
 * <Collapse open> — a disclosure that opens and closes instead of blinking.
 *
 * The animation is a CSS grid row: the wrapper is a one-row grid whose track
 * goes from `0fr` to `1fr`, and the content sits in an `overflow: hidden`
 * track that the browser shrinks with it. That buys the awkward parts for
 * free — both directions animate, flipping the toggle mid-flight retargets
 * from the current frame instead of jumping, nothing is measured, nothing is
 * left inline afterwards, and it works before hydration.
 *
 * - By default the content stays mounted, so a panel keeps what the owner
 *   typed and images are not re-fetched when it closes and reopens; `inert`
 *   takes it out of the tab order and the accessibility tree while it is shut.
 * - `lazy` gives that up for panels that are expensive to keep: a shut panel
 *   renders nothing at all, so it contributes no nodes, no form controls and
 *   no effects. It still animates open (the content mounts into the expanding
 *   track); closing is instant, because the content leaves with the toggle.
 *   Use it where a page holds many disclosures — forty shut dish forms are
 *   ~5,000 nodes nobody is looking at.
 * - `prefers-reduced-motion` snaps open and shut.
 * - Timing matches the app's height-reveal base (300ms, decelerating), so a
 *   disclosure and a revealed banner move together.
 * - The wrapper is layout-neutral: put padding and borders on the content, or
 *   the shut block will still reserve that space.
 * - Paint containment keeps a shut panel out of the page's scrollable height.
 *   The content inside the `0fr` track stays fully laid out — only its
 *   painting is clipped — and the browser counts that clipped overflow in the
 *   document's scroll area, so a tall shut panel (twenty dish rows with a few
 *   forms open) leaves thousands of pixels of blank page below the footer.
 *   `contain: paint` makes the page's scroll area follow the collapsed wrapper
 *   instead. It is safe here because the wrapper has no padding of its own and
 *   must already be layout-neutral, and because nothing inside a disclosure
 *   positions itself against the viewport.
 */

import type { ReactNode } from "react";

export interface CollapseProps {
  open: boolean;
  children: ReactNode;
  /** Extra classes for the grid wrapper. */
  className?: string;
  /**
   * Render the content only while the panel is open. A closed panel then costs
   * nothing, at the price of uncommitted local state inside it not surviving a
   * close, and of the close being a snap rather than a glide.
   */
  lazy?: boolean;
}

export function Collapse({ open, children, className = "", lazy = false }: CollapseProps) {
  const show = !lazy || open;

  return (
    <div
      className={[
        "grid [contain:paint] transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-h-0 overflow-hidden">
        <div inert={!open}>{show ? children : null}</div>
      </div>
    </div>
  );
}

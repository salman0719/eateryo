"use client";

/**
 * Reusable "look here" primitive: scroll a region into view and/or pulse it
 * when `active` flips false → true. Use it wherever one step of a flow
 * unlocks the next (e.g. the last price check revealing "Get your link").
 *
 * - Outer instance scrolls (and optionally pulses the box).
 * - Nested `inline` instance pulses just the button inside without scrolling
 *   twice.
 * - Respects `prefers-reduced-motion`: scrolls instantly and swaps the pulse
 *   for a static outline.
 */

import { useEffect, useRef, type ReactNode } from "react";

export const ATTENTION_PULSE_CLASS = "attention-pulse";

/** True only on the transition that should steal attention: had work, now none. */
export function didClearAll(previousCount: number, nextCount: number): boolean {
  return previousCount > 0 && nextCount === 0;
}

interface AttentionProps {
  /** When this flips false → true the region scrolls into view and pulses. */
  active: boolean;
  children: ReactNode;
  className?: string;
  /** Scroll this region into view on activation. Default true. */
  scroll?: boolean;
  /** Apply the pulse ring while active. Default true. */
  pulse?: boolean;
  scrollBlock?: ScrollIntoViewOptions["block"];
  /** Render as an inline span (for wrapping a button) instead of a div. */
  inline?: boolean;
}

export function Attention({
  active,
  children,
  className = "",
  scroll = true,
  pulse = true,
  scrollBlock = "center",
  inline = false,
}: AttentionProps) {
  const ref = useRef<HTMLDivElement | HTMLSpanElement | null>(null);
  const wasActive = useRef(active);

  useEffect(() => {
    if (!wasActive.current && active && scroll) {
      const el = ref.current;
      if (el?.scrollIntoView) {
        const reduce =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try {
          el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: scrollBlock });
        } catch {
          // jsdom / older browsers without scrollIntoView options — ignore.
        }
      }
    }
    wasActive.current = active;
  }, [active, scroll, scrollBlock]);

  const cls = [className, pulse && active ? ATTENTION_PULSE_CLASS : ""]
    .filter(Boolean)
    .join(" ");

  if (inline) {
    return (
      <span
        ref={ref as React.RefObject<HTMLSpanElement>}
        className={cls || undefined}
      >
        {children}
      </span>
    );
  }
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className={cls || undefined}>
      {children}
    </div>
  );
}

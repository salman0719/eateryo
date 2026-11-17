"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronLeftIcon } from "@/components/ui/icons";

/**
 * A sideways-scrollable pill row with edge arrows instead of a bar.
 *
 * Each arrow is an overlay, not layout: it fades in only while there is
 * more content in its direction and a press moves the row by ~three
 * quarters of the visible width. Touch-drag, trackpad, wheel and keyboard
 * all keep working — the scroll region stays focusable so arrow keys move
 * through the pills natively. When everything fits, both arrows stay off.
 */
export function ScrollArrowStrip({
  as = "div",
  label,
  children,
}: {
  /**
   * `nav` keeps the editor's categories landmark, `tablist` keeps the
   * editor's Menu sections tablist, `div` for a row inside a landmark.
   */
  as?: "nav" | "div" | "tablist";
  /** Accessible name for the scroll region. */
  label: string;
  children: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      setCanLeft(track.scrollLeft > 4);
      setCanRight(max > 4 && track.scrollLeft < max - 4);
    };
    update();
    const frame = requestAnimationFrame(update);
    track.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  function nudge(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({
      left: direction * Math.max(160, track.clientWidth * 0.75),
      behavior: reduce ? "auto" : "smooth",
    });
  }

  const arrow =
    "absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-line-300 bg-surface-base p-1.5 text-ink-700 shadow-sm transition-opacity hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

  const trackClass =
    "no-scrollbar flex items-center gap-1 overflow-x-auto py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

  const track =
    as === "nav" ? (
      <nav ref={trackRef} aria-label={label} tabIndex={0} className={trackClass}>
        {children}
      </nav>
    ) : as === "tablist" ? (
      <div ref={trackRef} role="tablist" aria-label={label} tabIndex={0} className={trackClass}>
        {children}
      </div>
    ) : (
      <div ref={trackRef} role="region" aria-label={label} tabIndex={0} className={trackClass}>
        {children}
      </div>
    );

  return (
    <div className="relative min-w-0 flex-1">
      {track}
      <button
        type="button"
        aria-label={`Scroll ${label} back`}
        onClick={() => nudge(-1)}
        tabIndex={canLeft ? 0 : -1}
        className={`${arrow} left-0 ${canLeft ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <ChevronLeftIcon size={14} />
      </button>
      <button
        type="button"
        aria-label={`Scroll ${label} forward`}
        onClick={() => nudge(1)}
        tabIndex={canRight ? 0 : -1}
        className={`${arrow} right-0 ${canRight ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <ChevronLeftIcon size={14} className="rotate-180" />
      </button>
    </div>
  );
}

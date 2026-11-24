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
  trackClassName,
  children,
}: {
  /**
   * `nav` keeps the editor's categories landmark, `tablist` keeps the
   * editor's Menu sections tablist, `div` for a row inside a landmark,
   * `ul` when the scrollable children are list items (dish cards).
   */
  as?: "nav" | "div" | "tablist" | "ul";
  /** Accessible name for the scroll region. */
  label: string;
  /** Override the track layout (gap, alignment, snap, padding). */
  trackClassName?: string;
  children: ReactNode;
}) {
  const trackRef = useRef<HTMLElement | null>(null);
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
    // Adding, renaming or deleting a pill changes the scrollable width
    // without resizing the track itself, so watch the contents too.
    const contents = new MutationObserver(update);
    contents.observe(track, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", update);
      observer.disconnect();
      contents.disconnect();
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
    "absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-surface-900 bg-surface-900 p-1.5 text-on-accent shadow-md transition-opacity hover:bg-surface-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

  // The tablist sits on the header rule: no vertical padding of its own, and
  // the track itself carries the -mb-px pull so the active tab's border
  // overlaps the rule. The pull lives on the track — a child of the plain
  // block wrapper — and never on the tabs, because a tab hanging past a
  // scroll container's edge paints unreliably on some mobile browsers, while
  // a negative margin in ordinary block layout always paints. Other rows keep
  // the breathing room and no pull.
  const trackClass =
    "no-scrollbar flex overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
    (trackClassName ?? "items-center gap-1" + (as === "tablist" ? " -mb-px" : " py-0.5"));

  const track =
    as === "nav" ? (
      <nav
        ref={trackRef as React.Ref<HTMLElement>}
        aria-label={label}
        tabIndex={0}
        className={trackClass}
      >
        {children}
      </nav>
    ) : as === "tablist" ? (
      <div
        ref={trackRef as React.Ref<HTMLDivElement>}
        role="tablist"
        aria-label={label}
        tabIndex={0}
        className={trackClass}
      >
        {children}
      </div>
    ) : as === "ul" ? (
      <ul
        ref={trackRef as React.Ref<HTMLUListElement>}
        aria-label={label}
        tabIndex={0}
        className={trackClass}
      >
        {children}
      </ul>
    ) : (
      <div
        ref={trackRef as React.Ref<HTMLDivElement>}
        role="region"
        aria-label={label}
        tabIndex={0}
        className={trackClass}
      >
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

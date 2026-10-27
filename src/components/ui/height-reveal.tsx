"use client";

/**
 * <HeightReveal> — present a component by animating its measured height from
 * 0 to whatever it actually needs, instead of hard-coding a pixel value.
 *
 *   <HeightReveal observeResize>
 *     <SomeComponent />
 *   </HeightReveal>
 *
 * - The wrapper measures its content; nothing about the height is configured.
 * - When an animation lands, the inline height is removed and the box is back
 *   on `height: auto`, so content stays responsive.
 * - `observeResize` is the opt-in: later content-driven height changes (more
 *   rows, narrower container, loaded fonts) animate from the current height
 *   instead of jumping.
 * - `prefers-reduced-motion` shows the content immediately.
 * - The wrapper is server-rendered at height 0 with `overflow: hidden`, so a
 *   hydration pass never flashes the full content first. That does mean the
 *   content is hidden until hydration runs; do not wrap critical, no-JS
 *   content in it.
 * - The wrapper is layout-neutral by design: do not put padding, borders or an
 *   explicit height on it. Style the component inside instead. The content
 *   sits in an inner `flow-root` box, so its child margins are measured and
 *   clipped with it instead of collapsing out of the animated box.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import {
  createHeightReveal,
  HEIGHT_REVEAL_DURATION,
  HEIGHT_REVEAL_EASING,
  HEIGHT_REVEAL_MIN_CHANGE,
  readResizeHeight,
  type HeightRevealController,
} from "@/lib/motion/height-reveal";

/** Layout effects only run on the client; fall back to an effect during SSR. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** `flow-root` contains the child's margins, so they are measured and clipped. */
const CONTENT_STYLE: CSSProperties = { display: "flow-root" };

export interface HeightRevealProps {
  /** The component or content to present. */
  children: ReactNode;
  /** Element used for the animated box. Default `div`. */
  as?: "div" | "section" | "article" | "aside" | "li";
  className?: string;
  style?: CSSProperties;
  /** Base duration in ms at ~320px of travel. Default 320. */
  duration?: number;
  /** CSS easing for the height animation. */
  easing?: string;
  /**
   * Opt in to watching the content: animate later height changes (content
   * edits, reflow from a narrower container, font swaps) from the current
   * height. Off by default — observation costs a ResizeObserver.
   */
  observeResize?: boolean;
  /** Animate the entrance. Set false to start at the natural height. */
  revealOnMount?: boolean;
  /** Height changes below this many CSS pixels are ignored. Default 1. */
  minChange?: number;
  /** Fires once the entrance has landed, with the measured height. */
  onRevealed?: (info: { height: number }) => void;
}

export function HeightReveal({
  children,
  as = "div",
  className,
  style,
  duration = HEIGHT_REVEAL_DURATION,
  easing = HEIGHT_REVEAL_EASING,
  observeResize = false,
  revealOnMount = true,
  minChange = HEIGHT_REVEAL_MIN_CHANGE,
  onRevealed,
}: HeightRevealProps) {
  const outerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<HeightRevealController | null>(null);

  // Read-once values: the entrance is a mount concern, and timing props are
  // design constants, so they are not effect dependencies (changing them must
  // not replay the animation).
  const initialConfig = useRef({ duration, easing, minChange, revealOnMount });
  const revealedRef = useRef(onRevealed);
  const measuredRef = useRef(0);

  useEffect(() => {
    revealedRef.current = onRevealed;
  });

  useIsomorphicLayoutEffect(() => {
    const outer = outerRef.current;
    const content = contentRef.current;
    if (!outer || !content) return;

    const config = initialConfig.current;
    const controller = createHeightReveal(outer, {
      duration: config.duration,
      easing: config.easing,
      minChange: config.minChange,
      ownsPendingStyles: config.revealOnMount,
      onRevealed: (info) => revealedRef.current?.(info),
    });
    controllerRef.current = controller;

    // Measured before the first paint: the inner box is never height-clamped,
    // even while its parent is still at 0.
    const naturalHeight = content.getBoundingClientRect().height;
    measuredRef.current = naturalHeight;

    if (config.revealOnMount) controller.reveal(naturalHeight);
    else controller.settle(naturalHeight);

    return () => {
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!observeResize || typeof ResizeObserver === "undefined") return;
    const content = contentRef.current;
    const controller = controllerRef.current;
    if (!content || !controller) return;

    // Observation can be switched on later. Re-anchor the controller to the
    // height on screen first, so the next change animates from here instead of
    // from a stale mount-time value. Safe only when nothing is animating.
    const currentHeight = content.getBoundingClientRect().height;
    if (controller.phase === "open") controller.settle(currentHeight);

    // The first observation always fires. Seeding with the current size keeps
    // it from starting a redundant animation; any real change gets one.
    let lastHeight = currentHeight;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const height = readResizeHeight(entry);
      if (!Number.isFinite(height) || Math.abs(height - lastHeight) < 0.5) return;
      lastHeight = height;
      // ResizeObserver callbacks run before paint, so this retarget lands in
      // the same frame as the layout change that caused it.
      controller.transitionTo(height);
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [observeResize]);

  const Tag = as as ElementType;

  return (
    <Tag
      ref={outerRef}
      className={className}
      style={revealOnMount ? { ...style, height: 0, overflow: "hidden" } : style}
    >
      <div ref={contentRef} style={CONTENT_STYLE}>
        {children}
      </div>
    </Tag>
  );
}

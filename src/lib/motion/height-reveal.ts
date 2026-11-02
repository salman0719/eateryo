/**
 * Height reveal — a small, dependency-free core for animating a block into
 * the layout instead of letting it pop in.
 *
 * Why it looks like this:
 *
 * - The height is *measured*, never configured. The controller is told the
 *   natural height of the content (the React wrapper reads it from the DOM),
 *   so a 412px card, a 74px banner, and a 1600px menu all work without a prop.
 * - Height is animated with the Web Animations API, not a CSS class. That lets
 *   a running reveal be retargeted mid-flight: measure the current frame,
 *   freeze it in the inline style, cancel, and animate onwards from there. A
 *   CSS transition would either jump or need a forced reflow to do the same.
 * - When an animation lands, the inline height is removed. The block goes back
 *   to `height: auto`, so wrapping, font loading, zoom and content edits keep
 *   working without the controller holding a stale pixel value.
 * - `overflow` is clipped only while a frame can overflow (the reveal and any
 *   opt-in resize animation). Once settled the box is layout-neutral, so
 *   shadows, focus rings and popovers are not trapped by a permanent
 *   `overflow: hidden`.
 * - `prefers-reduced-motion: reduce` skips the animation instead of shortening
 *   it: content appears at its natural height immediately.
 *
 * The core is DOM-only and has no React dependency, so the React wrapper
 * (`src/components/ui/height-reveal.tsx`) stays a thin adapter and the logic
 * can be tested without a browser.
 */

/** Base reveal duration for a ~320px change. Distances scale around it. */
export const HEIGHT_REVEAL_DURATION = 320;

/** Decelerating ease-out: quick to start, calm on arrival. */
export const HEIGHT_REVEAL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Changes smaller than this many CSS pixels are not worth an animation. */
export const HEIGHT_REVEAL_MIN_CHANGE = 1;

/** Distance at which the base duration applies unchanged. */
const REFERENCE_DISTANCE = 320;

/**
 * Duration is proportional to `sqrt(distance)`, clamped: four times the
 * distance is twice the time (a 1280px reveal gets 640ms, not 1280ms), and
 * tiny changes still get a readable beat instead of a 40ms flicker.
 */
const MIN_DURATION_FACTOR = 0.5;
const MAX_DURATION_FACTOR = 2;

/** Sub-pixel noise below this is never animated, even with `minChange: 0`. */
const MIN_ANIMATABLE_DISTANCE = 0.5;

export type HeightRevealPhase = "hidden" | "revealing" | "open" | "destroyed";

export interface HeightRevealOptions {
  /** Base duration in ms (the value used at ~320px). Default 320. */
  duration?: number;
  /** CSS easing for the height animation. */
  easing?: string;
  /**
   * Scale the duration with the distance travelled. Default true; this is what
   * keeps a tall menu from feeling violent and a short row from feeling slow.
   */
  adaptive?: boolean;
  /** Ignore height changes smaller than this (CSS pixels). Default 1. */
  minChange?: number;
  /**
   * True when the wrapper was server-rendered at height 0 with
   * `overflow: hidden` by this library. The first reveal then clears that
   * inline overflow instead of restoring it, because it was never the
   * consumer's style.
   */
  ownsPendingStyles?: boolean;
  /** Fires once the entrance has landed (or immediately if it cannot animate). */
  onRevealed?: (info: { height: number }) => void;
}

export interface HeightRevealController {
  readonly phase: HeightRevealPhase;
  /** Entrance: animate from 0 to the measured natural height. */
  reveal(naturalHeight: number): void;
  /** Animate from whatever height is on screen now to a new natural height. */
  transitionTo(naturalHeight: number): void;
  /** Stop any animation and put the element back on `height: auto`. */
  settle(naturalHeight?: number): void;
  /** Cancel and release everything; the element keeps its natural height. */
  destroy(): void;
}

/**
 * Duration for a height change. Exported so callers can show or tune timing.
 * Returns 0 when there is nothing to animate.
 */
export function getRevealDuration(
  distancePx: number,
  base = HEIGHT_REVEAL_DURATION,
  adaptive = true
): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0 || base <= 0) return 0;
  if (!adaptive) return Math.round(base);
  const factor = Math.min(
    MAX_DURATION_FACTOR,
    Math.max(MIN_DURATION_FACTOR, Math.sqrt(distancePx / REFERENCE_DISTANCE))
  );
  return Math.round(base * factor);
}

/** True when a height change is big enough that animating it is worth a frame. */
export function isAnimatableDistance(
  distancePx: number,
  minChange = HEIGHT_REVEAL_MIN_CHANGE
): boolean {
  if (!Number.isFinite(distancePx)) return false;
  const threshold = Math.max(MIN_ANIMATABLE_DISTANCE, minChange);
  return Math.abs(distancePx) >= threshold;
}

type ResizeHeightEntry = {
  borderBoxSize?: ReadonlyArray<{ blockSize: number }> | { blockSize: number };
  contentRect?: { height: number };
};

/**
 * Natural height from a ResizeObserver entry.
 *
 * `borderBoxSize` is layout size, so transforms on the content do not skew it;
 * older engines hand back a single object instead of an array, and very old
 * ones only fill `contentRect`. The inner wrapper has no padding or border, so
 * all three agree there.
 */
export function readResizeHeight(entry: ResizeHeightEntry): number {
  const raw = entry.borderBoxSize;
  const box = Array.isArray(raw) ? raw[0] : (raw as { blockSize: number } | undefined);
  if (box && Number.isFinite(box.blockSize)) return box.blockSize;
  const height = entry.contentRect?.height;
  return typeof height === "number" && Number.isFinite(height) ? height : 0;
}

/** Read the OS "reduce motion" preference, safely, including on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function normalizeHeight(height: number): number {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

/**
 * Create a controller for one element.
 *
 * The element is the box whose height is animated. It should not carry its own
 * padding or border: the measured height is the content's border-box and the
 * controller restores `height: auto` afterwards, so a padded wrapper would
 * settle at a different size than it animated to.
 */
export function createHeightReveal(
  element: HTMLElement,
  options: HeightRevealOptions = {}
): HeightRevealController {
  const {
    duration = HEIGHT_REVEAL_DURATION,
    easing = HEIGHT_REVEAL_EASING,
    adaptive = true,
    minChange = HEIGHT_REVEAL_MIN_CHANGE,
    ownsPendingStyles = false,
    onRevealed,
  } = options;

  let phase: HeightRevealPhase = "hidden";
  let animation: Animation | null = null;
  /** Last natural height we were told about; guards against RO echo loops. */
  let target: number | null = null;
  let announced = false;
  let savedOverflow: string | null = null;
  let overflowLocked = false;

  function lockOverflow() {
    if (overflowLocked) return;
    savedOverflow = ownsPendingStyles ? "" : element.style.getPropertyValue("overflow");
    // `clip` never produces a scrollbar in the middle of an animation;
    // `hidden` is the fallback for engines without `clip`, and the later
    // declaration wins wherever both are valid.
    element.style.setProperty("overflow", "hidden");
    element.style.setProperty("overflow", "clip");
    overflowLocked = true;
  }

  function unlockOverflow() {
    if (!overflowLocked) {
      // A reveal can finish before it ever animates (reduced motion, empty
      // content). Its server-rendered `overflow: hidden` is still ours to drop.
      if (ownsPendingStyles) element.style.removeProperty("overflow");
      return;
    }
    if (savedOverflow) element.style.setProperty("overflow", savedOverflow);
    else element.style.removeProperty("overflow");
    overflowLocked = false;
    savedOverflow = null;
  }

  /**
   * Freeze the frame that is currently on screen into the inline style, then
   * cancel. Reading the rect while the animation still has its effect is what
   * makes a mid-flight retarget seamless.
   */
  function stopAnimation(): number | null {
    if (!animation) return null;
    const current = element.getBoundingClientRect().height;
    const run = animation;
    animation = null;
    run.onfinish = null;
    element.style.setProperty("height", `${current}px`);
    run.cancel();
    return current;
  }

  function settle(naturalHeight?: number) {
    if (phase === "destroyed") return;
    // Recording the height keeps later resize animations anchored to what is
    // on screen, even when the entrance was skipped entirely.
    if (naturalHeight !== undefined && Number.isFinite(naturalHeight)) {
      target = normalizeHeight(naturalHeight);
    }
    const height = target ?? element.getBoundingClientRect().height;
    if (animation) {
      const run = animation;
      animation = null;
      run.onfinish = null;
      // Put layout back in charge before cancelling the forwards fill, so the
      // box never paints at the animation's start height for a frame.
      element.style.removeProperty("height");
      run.cancel();
    } else {
      element.style.removeProperty("height");
    }
    unlockOverflow();
    phase = "open";
    if (!announced) {
      announced = true;
      onRevealed?.({ height });
    }
  }

  function animateTo(next: number, from: number) {
    const distance = Math.abs(next - from);
    if (
      phase === "destroyed" ||
      !isAnimatableDistance(distance, minChange) ||
      prefersReducedMotion() ||
      typeof element.animate !== "function"
    ) {
      settle();
      return;
    }

    const runDuration = getRevealDuration(distance, duration, adaptive);
    if (runDuration <= 0) {
      settle();
      return;
    }

    lockOverflow();
    element.style.setProperty("height", `${from}px`);

    let run: Animation;
    try {
      run = element.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration: runDuration,
        easing,
        fill: "forwards",
      });
    } catch {
      // Unsupported keyframes/easing: fall back to showing the content.
      settle();
      return;
    }

    animation = run;
    run.onfinish = () => {
      if (animation !== run) return;
      settle();
    };
  }

  function reveal(naturalHeight: number) {
    if (phase === "destroyed") return;
    const next = normalizeHeight(naturalHeight);

    if (phase !== "hidden") {
      transitionTo(next);
      return;
    }

    phase = "revealing";
    target = next;

    if (!isAnimatableDistance(next, minChange)) {
      // Nothing to reveal (empty or collapsed content): go straight to auto.
      settle();
      return;
    }

    animateTo(next, 0);
  }

  function transitionTo(naturalHeight: number) {
    if (phase === "destroyed") return;
    const next = normalizeHeight(naturalHeight);

    if (phase === "hidden") {
      reveal(next);
      return;
    }

    // ResizeObserver can echo a height we already own (the initial observation
    // always fires, and layout changes elsewhere can round-trip). Never start a
    // second animation for a target we are already heading to.
    const previous = target;
    if (previous !== null && !isAnimatableDistance(next - previous, minChange)) return;
    target = next;

    const frozen = stopAnimation();
    // While no animation runs, the box is on `height: auto` and has therefore
    // *already* grown or shrunk to the new content size by the time a
    // ResizeObserver callback fires (it runs after layout, before paint).
    // Starting from that rect would leave nothing to animate, so use the last
    // height we actually laid out — the size before this change.
    const from = frozen ?? previous ?? element.getBoundingClientRect().height;
    if (!isAnimatableDistance(next - from, minChange)) {
      // The frozen frame is already where the content landed, but the old
      // animation is cancelled by now — hand the box back to layout instead of
      // leaving it pinned at that frame.
      settle();
      return;
    }

    animateTo(next, from);
  }

  function destroy() {
    if (phase === "destroyed") return;
    if (animation) {
      const run = animation;
      animation = null;
      run.onfinish = null;
      element.style.removeProperty("height");
      run.cancel();
    }
    element.style.removeProperty("height");
    unlockOverflow();
    phase = "destroyed";
  }

  return {
    reveal,
    transitionTo,
    settle,
    destroy,
    get phase() {
      return phase;
    },
  };
}

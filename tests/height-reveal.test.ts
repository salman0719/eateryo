import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHeightReveal,
  getRevealDuration,
  isAnimatableDistance,
  prefersReducedMotion,
  readResizeHeight,
  type HeightRevealOptions,
} from "../src/lib/motion/height-reveal";

class FakeAnimation {
  onfinish: (() => void) | null = null;
  cancelled = false;
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;

  constructor(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    this.keyframes = keyframes;
    this.options = options;
  }

  cancel() {
    this.cancelled = true;
  }
}

class FakeElement {
  layoutHeight = 0;
  readonly styleValues = new Map<string, string>();
  readonly runs: FakeAnimation[] = [];

  readonly style = {
    setProperty: (name: string, value: string) => {
      this.styleValues.set(name, value);
    },
    getPropertyValue: (name: string) => this.styleValues.get(name) ?? "",
    removeProperty: (name: string) => {
      this.styleValues.delete(name);
    },
  };

  getBoundingClientRect() {
    return { height: this.layoutHeight } as DOMRect;
  }

  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const run = new FakeAnimation(keyframes, options);
    this.runs.push(run);
    // A real animation paints its first frame immediately.
    this.layoutHeight = Number.parseFloat(String(keyframes[0].height)) || 0;
    return {
      set onfinish(handler: (() => void) | null) {
        run.onfinish = handler;
      },
      get onfinish() {
        return run.onfinish;
      },
      cancel: () => run.cancel(),
    } as unknown as Animation;
  }

  /** Whatever the browser would do when the last animation completes. */
  finish(run: FakeAnimation) {
    this.layoutHeight = Number.parseFloat(String(run.keyframes[1].height)) || 0;
    run.onfinish?.();
  }
}

function setup(options: HeightRevealOptions = {}) {
  const element = new FakeElement();
  const revealed: Array<{ height: number }> = [];
  const controller = createHeightReveal(element as unknown as HTMLElement, {
    onRevealed: (info) => revealed.push(info),
    ...options,
  });
  return { element, controller, revealed };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRevealDuration", () => {
  it("returns the base duration at the reference distance", () => {
    expect(getRevealDuration(320)).toBe(320);
  });

  it("scales with the square root of the distance and clamps both ends", () => {
    expect(getRevealDuration(412)).toBe(363);
    expect(getRevealDuration(1280)).toBe(640);
    expect(getRevealDuration(3200)).toBe(640);
    expect(getRevealDuration(12)).toBe(160);
  });

  it("returns 0 for nothing to animate and supports a fixed duration", () => {
    expect(getRevealDuration(0)).toBe(0);
    expect(getRevealDuration(-40)).toBe(0);
    expect(getRevealDuration(400, 0)).toBe(0);
    expect(getRevealDuration(400, 300, false)).toBe(300);
  });
});

describe("isAnimatableDistance", () => {
  it("ignores sub-pixel noise and respects a caller threshold", () => {
    expect(isAnimatableDistance(0.4)).toBe(false);
    expect(isAnimatableDistance(0.5)).toBe(false);
    expect(isAnimatableDistance(1)).toBe(true);
    expect(isAnimatableDistance(-1)).toBe(true);
    expect(isAnimatableDistance(Number.NaN)).toBe(false);
    expect(isAnimatableDistance(0.5, 0.5)).toBe(true);
    expect(isAnimatableDistance(3, 4)).toBe(false);
    expect(isAnimatableDistance(4, 4)).toBe(true);
  });
});

describe("readResizeHeight", () => {
  it("prefers border-box block size", () => {
    expect(readResizeHeight({ borderBoxSize: [{ blockSize: 412.5 }] })).toBe(412.5);
  });

  it("accepts the single-object shape older engines return", () => {
    expect(readResizeHeight({ borderBoxSize: { blockSize: 318 } })).toBe(318);
  });

  it("falls back to contentRect, then to 0", () => {
    expect(readResizeHeight({ contentRect: { height: 74 } })).toBe(74);
    expect(readResizeHeight({ borderBoxSize: [{ blockSize: Number.NaN }] })).toBe(0);
    expect(readResizeHeight({})).toBe(0);
  });
});

describe("prefersReducedMotion", () => {
  it("is false without a browser", () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("createHeightReveal", () => {
  it("animates 0 → measured height, then leaves the box on height auto", () => {
    const { element, controller, revealed } = setup();
    element.layoutHeight = 412;

    controller.reveal(412);

    expect(controller.phase).toBe("revealing");
    expect(element.runs).toHaveLength(1);
    expect(element.runs[0].keyframes).toEqual([{ height: "0px" }, { height: "412px" }]);
    expect(element.runs[0].options.fill).toBe("forwards");
    expect(element.runs[0].options.duration).toBe(getRevealDuration(412));
    expect(element.style.getPropertyValue("height")).toBe("0px");
    expect(element.style.getPropertyValue("overflow")).toBe("clip");

    element.finish(element.runs[0]);

    expect(controller.phase).toBe("open");
    // No lingering pixel height: the layout owns the size again.
    expect(element.style.getPropertyValue("height")).toBe("");
    expect(element.style.getPropertyValue("overflow")).toBe("");
    expect(revealed).toEqual([{ height: 412 }]);
  });

  it("retargets a running reveal from the frame on screen", () => {
    const { element, controller } = setup();
    controller.reveal(412);

    // Mid-flight: the box is currently 180px tall and the content grew.
    element.layoutHeight = 180;
    controller.transitionTo(300);

    expect(element.runs[0].cancelled).toBe(true);
    expect(element.runs).toHaveLength(2);
    expect(element.runs[1].keyframes).toEqual([{ height: "180px" }, { height: "300px" }]);

    element.finish(element.runs[1]);
    expect(controller.phase).toBe("open");
  });

  it("animates later height changes from the last laid-out height, not the updated rect", () => {
    const { element, controller } = setup();
    controller.reveal(412);
    element.finish(element.runs[0]);
    // ResizeObserver runs after layout, so the auto-height box already reports
    // the new size by the time the callback reaches the controller.
    element.layoutHeight = 520;

    controller.transitionTo(520);

    expect(element.runs).toHaveLength(2);
    expect(element.runs[1].keyframes).toEqual([{ height: "412px" }, { height: "520px" }]);
  });

  it("anchors the first resize animation when the entrance was skipped", () => {
    const { element, controller } = setup();
    element.layoutHeight = 240;
    controller.settle(240);
    expect(element.runs).toHaveLength(0);
    element.layoutHeight = 300;

    controller.transitionTo(300);

    expect(element.runs).toHaveLength(1);
    expect(element.runs[0].keyframes).toEqual([{ height: "240px" }, { height: "300px" }]);
  });

  it("settles rather than sticking when a retarget lands on the current frame", () => {
    const { element, controller } = setup();
    controller.reveal(412);
    // Nearly done shrinking: the frame on screen is already 0.5px from the
    // new content height, while the old target was a full pixel away.
    element.layoutHeight = 411.5;

    controller.transitionTo(411);

    expect(element.runs).toHaveLength(1);
    expect(element.runs[0].cancelled).toBe(true);
    expect(controller.phase).toBe("open");
    expect(element.style.getPropertyValue("height")).toBe("");
    expect(element.style.getPropertyValue("overflow")).toBe("");
  });

  it("ignores echoes and changes below the threshold", () => {
    const { element, controller } = setup();
    controller.reveal(412);
    element.finish(element.runs[0]);
    element.layoutHeight = 412;

    controller.transitionTo(412); // ResizeObserver echo
    controller.transitionTo(412.4); // sub-pixel churn

    expect(element.runs).toHaveLength(1);
  });

  it("settles empty content without an animation", () => {
    const { element, controller, revealed } = setup();

    controller.reveal(0);

    expect(element.runs).toHaveLength(0);
    expect(controller.phase).toBe("open");
    expect(revealed).toEqual([{ height: 0 }]);
  });

  it("skips the animation when reduced motion is requested", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query.includes("reduce") }),
    });
    const { element, controller, revealed } = setup({ ownsPendingStyles: true });
    // What the server renders: hidden until the client takes over.
    element.style.setProperty("height", "0px");
    element.style.setProperty("overflow", "hidden");
    element.layoutHeight = 412;

    controller.reveal(412);

    expect(element.runs).toHaveLength(0);
    expect(controller.phase).toBe("open");
    expect(element.style.getPropertyValue("height")).toBe("");
    expect(element.style.getPropertyValue("overflow")).toBe("");
    expect(revealed).toEqual([{ height: 412 }]);
  });

  it("keeps a consumer's inline overflow and drops its own pending one", () => {
    const consumer = setup();
    consumer.element.style.setProperty("overflow", "visible");
    consumer.controller.reveal(412);
    consumer.element.finish(consumer.element.runs[0]);
    expect(consumer.element.style.getPropertyValue("overflow")).toBe("visible");

    const pending = setup({ ownsPendingStyles: true });
    pending.element.style.setProperty("overflow", "hidden");
    pending.controller.reveal(412);
    pending.element.finish(pending.element.runs[0]);
    expect(pending.element.style.getPropertyValue("overflow")).toBe("");
  });

  it("releases everything on destroy and never animates afterwards", () => {
    const { element, controller } = setup();
    controller.reveal(412);

    controller.destroy();

    expect(element.runs[0].cancelled).toBe(true);
    expect(element.style.getPropertyValue("height")).toBe("");
    expect(element.style.getPropertyValue("overflow")).toBe("");
    expect(controller.phase).toBe("destroyed");

    controller.transitionTo(900);
    expect(element.runs).toHaveLength(1);
  });

  it("reveals immediately when the element cannot animate", () => {
    const element = new FakeElement();
    Object.defineProperty(element, "animate", { value: undefined });
    const controller = createHeightReveal(element as unknown as HTMLElement);

    controller.reveal(412);

    expect(controller.phase).toBe("open");
    expect(element.style.getPropertyValue("height")).toBe("");
  });
});

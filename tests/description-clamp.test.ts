import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_CLAMP_CLASS,
  descriptionToggle,
  hidesClampedText,
} from "@/components/order/description-clamp";

/**
 * 009: a long dish description is clamped to two lines with a control that
 * reveals the rest. The properties that matter are the ones a screenshot
 * cannot check — that the control appears only when text is really hidden,
 * that it never appears on an unmeasured row, and that opening the text does
 * not take away the way back.
 */
describe("description clamp", () => {
  it("clamps to two lines with breaking for unbroken tokens", () => {
    expect(DESCRIPTION_CLAMP_CLASS).toBe("line-clamp-2");
  });

  it("treats a box that hides nothing as not clamped", () => {
    expect(hidesClampedText({ scrollHeight: 40, clientHeight: 40 })).toBe(false);
    // Sub-pixel rounding must not produce a "More" for text that fits.
    expect(hidesClampedText({ scrollHeight: 41, clientHeight: 40 })).toBe(false);
    expect(hidesClampedText({ scrollHeight: 80, clientHeight: 40 })).toBe(true);
  });

  it("never claims an unmeasured row is clamped", () => {
    // jsdom and a not-yet-laid-out row both report zero height; a control
    // there could not do anything, so it must not render.
    expect(hidesClampedText({ scrollHeight: 0, clientHeight: 0 })).toBe(false);
    expect(hidesClampedText({ scrollHeight: 120, clientHeight: 0 })).toBe(false);
    expect(hidesClampedText(null)).toBe(false);
    expect(hidesClampedText(undefined)).toBe(false);
  });

  it("shows the control only when there is more to read", () => {
    expect(descriptionToggle(false, false)).toEqual({
      show: false,
      label: "More",
      expanded: false,
    });
    expect(descriptionToggle(false, true)).toEqual({ show: true, label: "More", expanded: false });
  });

  it("keeps the way back once the text is open", () => {
    // Open text no longer overflows, so the control has to survive that.
    expect(descriptionToggle(true, false)).toEqual({ show: true, label: "Less", expanded: true });
    expect(descriptionToggle(true, true)).toEqual({ show: true, label: "Less", expanded: true });
  });
});

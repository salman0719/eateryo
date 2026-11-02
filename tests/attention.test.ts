import { describe, expect, it } from "vitest";

import { ATTENTION_PULSE_CLASS, didClearAll } from "@/components/ui/attention";

describe("didClearAll", () => {
  it("fires only on the had-work → none transition", () => {
    expect(didClearAll(3, 0)).toBe(true);
    expect(didClearAll(1, 0)).toBe(true);
    expect(didClearAll(0, 0)).toBe(false);
    expect(didClearAll(3, 1)).toBe(false);
    expect(didClearAll(0, 2)).toBe(false);
  });

  it("exposes a single shared pulse class for every consumer", () => {
    expect(ATTENTION_PULSE_CLASS).toBe("attention-pulse");
  });
});

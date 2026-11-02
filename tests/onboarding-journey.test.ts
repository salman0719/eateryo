import { describe, expect, it } from "vitest";

import {
  JOURNEY_STEPS,
  PUBLISH_STEP_INDEX,
  journeyStepStatus,
} from "@/features/onboarding/journey";

describe("onboarding journey", () => {
  it("is one fixed four-stop journey ending in Publish", () => {
    expect(JOURNEY_STEPS).toEqual(["Upload", "Extract", "Review", "Publish"]);
    expect(JOURNEY_STEPS[PUBLISH_STEP_INDEX]).toBe("Publish");
    // Sign-in is a gate inside Publish, never a stop: a tracker whose length
    // depends on whether the owner is signed in is the failure it must avoid.
    expect(JOURNEY_STEPS).not.toContain("Sign in");
  });

  it("marks stops done, current and upcoming", () => {
    expect(journeyStepStatus(0, 0)).toBe("current");
    expect(journeyStepStatus(0, 2)).toBe("done");
    expect(journeyStepStatus(2, 2)).toBe("current");
    expect(journeyStepStatus(3, 2)).toBe("upcoming");
    expect(journeyStepStatus(3, PUBLISH_STEP_INDEX)).toBe("current");
  });

  it("stays inside the journey for out-of-range indices", () => {
    expect(journeyStepStatus(3, 99)).toBe("done");
    expect(journeyStepStatus(0, -1)).toBe("upcoming");
  });
});

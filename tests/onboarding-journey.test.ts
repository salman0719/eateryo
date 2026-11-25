import { describe, expect, it } from "vitest";

import {
  JOURNEY_STEPS,
  PUBLISH_STEP_INDEX,
  REVIEW_STEP_INDEX,
  journeyStepStatus,
} from "@/features/onboarding/journey";

describe("onboarding journey", () => {
  it("is one fixed three-stop journey ending in Publish", () => {
    expect(JOURNEY_STEPS).toEqual(["Upload & extract", "Review", "Publish"]);
    expect(JOURNEY_STEPS[PUBLISH_STEP_INDEX]).toBe("Publish");
    expect(JOURNEY_STEPS[REVIEW_STEP_INDEX]).toBe("Review");
    // Extraction is an action inside the first stop, never a stop of its own:
    // a separate stop invites a second press of the one paid call.
    expect(JOURNEY_STEPS).not.toContain("Extract");
    // Sign-in is a gate inside Publish, never a stop: a tracker whose length
    // depends on whether the owner is signed in is the failure it must avoid.
    expect(JOURNEY_STEPS).not.toContain("Sign in");
  });

  it("marks stops done, current and upcoming", () => {
    expect(journeyStepStatus(0, 0)).toBe("current");
    expect(journeyStepStatus(0, 2)).toBe("done");
    expect(journeyStepStatus(REVIEW_STEP_INDEX, REVIEW_STEP_INDEX)).toBe("current");
    expect(journeyStepStatus(REVIEW_STEP_INDEX, 0)).toBe("upcoming");
    expect(journeyStepStatus(PUBLISH_STEP_INDEX, REVIEW_STEP_INDEX)).toBe("upcoming");
    expect(journeyStepStatus(PUBLISH_STEP_INDEX, PUBLISH_STEP_INDEX)).toBe("current");
  });

  it("stays inside the journey for out-of-range indices", () => {
    expect(journeyStepStatus(PUBLISH_STEP_INDEX, 99)).toBe("done");
    expect(journeyStepStatus(0, -1)).toBe("upcoming");
  });
});

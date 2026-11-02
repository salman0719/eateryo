/**
 * The one onboarding journey, shared by every screen that shows progress.
 *
 * Capture owns the first three stops (upload the photo, extract the draft,
 * review what the AI read) and the publish wizard is the fourth. It is
 * deliberately one fixed list: publishing is a stop, not a second journey,
 * and signing in is never a stop of its own. Sign-in only happens inside
 * Publish, and only when the account is missing, so the tracker never
 * changes length between owners — a step indicator whose count depends on
 * who is looking is exactly what step indicators are worst at.
 *
 * The CTA that leaves the review screen says "Publish" because that is the
 * stop it opens; there is no separate "get your link" errand in between.
 */
export const JOURNEY_STEPS = ["Upload", "Extract", "Review", "Publish"] as const;

export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** Index of the publish wizard, so the shell and the wizard never disagree. */
export const PUBLISH_STEP_INDEX = JOURNEY_STEPS.length - 1;

export type JourneyStepStatus = "done" | "current" | "upcoming";

/**
 * A stop is done once the journey has moved past it, current while the
 * owner is on it, and upcoming before that. Out-of-range indices stay
 * upcoming instead of throwing: a stale cookie must not break a screen.
 */
export function journeyStepStatus(index: number, current: number): JourneyStepStatus {
  if (index < current) return "done";
  if (index === current) return "current";
  return "upcoming";
}

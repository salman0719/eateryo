"use client";

import { JOURNEY_STEPS, journeyStepStatus } from "@/features/onboarding/journey";

/**
 * The one progress tracker for onboarding: Upload & extract · Review ·
 * Publish. Rendered on capture's signed-out front door and by the publish
 * wizard when it is opened on its own URL, so leaving the review screen
 * continues the same journey instead of starting a second one at "1".
 *
 * Upload and extraction share a stop: the read is an action inside the photo
 * step, so there is no stop that can be returned to and re-triggered.
 *
 * Full width by design: every stop but the last holds a flexible connector,
 * so the lines take up all the slack and the bar ends on the final label at
 * the right edge instead of clustering around the current step. The stops
 * `grow` from their own content width rather than splitting into equal
 * thirds — equal thirds squeeze "Upload & extract" into an ellipsis on a
 * phone even when the row has room to spare. Labels stay on one line and
 * truncate rather than wrap: a wrapped label makes the stops stand at
 * different heights, which is what a broken stepper looks like.
 *
 * States follow the checkout convention: the current stop is filled, done
 * stops carry a check, and upcoming stops stay outlined and low-emphasis
 * without ever reading as disabled. The pending label stays at stone-600
 * (~7:1) because it is still a step the owner will reach, not an
 * unavailable control — the old stone-500 sat at 4.5:1, right on the line.
 */
export function JourneySteps({
  current,
  className = "",
}: {
  /** Zero-based stop the owner is on. */
  current: number;
  className?: string;
}) {
  return (
    <ol
      aria-label="Getting your menu live"
      className={["flex w-full items-center gap-2 sm:gap-3", className].filter(Boolean).join(" ")}
    >
      {JOURNEY_STEPS.map((label, index) => {
        const status = journeyStepStatus(index, current);
        const last = index === JOURNEY_STEPS.length - 1;
        return (
          <li
            key={label}
            className={["flex min-w-0 items-center gap-2", last ? "shrink-0" : "grow"].join(" ")}
          >
            <span
              aria-current={status === "current" ? "step" : undefined}
              className={[
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold sm:h-6 sm:w-6 sm:text-xs",
                status === "upcoming"
                  ? "border border-line-300 bg-surface-base text-ink-600"
                  : "bg-accent-700 text-on-accent",
              ].join(" ")}
            >
              {status === "done" ? (
                <>
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">Completed</span>
                </>
              ) : (
                index + 1
              )}
            </span>
            <span
              className={[
                "min-w-0 truncate text-[11px] whitespace-nowrap leading-tight sm:text-sm",
                status === "current"
                  ? "font-semibold text-ink-900"
                  : status === "done"
                    ? "font-medium text-ink-700"
                    : "font-medium text-ink-600",
              ].join(" ")}
            >
              {label}
            </span>
            {!last && (
              <span
                aria-hidden="true"
                className={[
                  "h-px min-w-4 flex-1 rounded-full",
                  index < current ? "bg-accent-300" : "bg-line-300",
                ].join(" ")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

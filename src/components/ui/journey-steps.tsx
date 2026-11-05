"use client";

import { JOURNEY_STEPS, journeyStepStatus } from "@/features/onboarding/journey";

/**
 * The one progress tracker for onboarding: Upload · Extract · Review ·
 * Publish. Rendered by capture (stops 1–3) and by the publish wizard (stop
 * 4), so leaving the review screen continues the same journey instead of
 * starting a second one at "1".
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
      className={["flex items-center gap-0.5 sm:gap-2", className].filter(Boolean).join(" ")}
    >
      {JOURNEY_STEPS.map((label, index) => {
        const status = journeyStepStatus(index, current);
        return (
          <li key={label} className="flex flex-1 items-center gap-0.5 last:flex-none sm:gap-2">
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
                "text-[11px] leading-tight sm:text-sm",
                status === "current"
                  ? "font-semibold text-ink-900"
                  : status === "done"
                    ? "font-medium text-ink-700"
                    : "font-medium text-ink-600",
              ].join(" ")}
            >
              {label}
            </span>
            {index < JOURNEY_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={`h-px flex-1 ${index < current ? "bg-accent-300" : "bg-surface-200"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

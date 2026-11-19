"use client";

import { JOURNEY_STEPS, journeyStepStatus } from "@/features/onboarding/journey";

/**
 * Capture's stop rail: the three-stop journey as the one control that moves
 * between stops. The passive `JourneySteps` tracker stays on the signed-out
 * front door and in the publish wizard, where there is nothing to move to;
 * here every stop the owner has reached is a button, so "go back to the
 * photos" is a visible control rather than a remembered route.
 *
 * A stop that has not been reached yet is disabled, not hidden: the rail is
 * also the answer to "how much is left", and a control that only appears once
 * it is usable reads as a different screen each time.
 *
 * Presentational: the page owns which stop is showing and what is reachable.
 */
export type CaptureStop = "capture" | "review" | "publish";

const STOP_ORDER: readonly CaptureStop[] = ["capture", "review", "publish"];

export function CaptureStepRail({
  current,
  reachable,
  onSelect,
}: {
  current: CaptureStop;
  /** Stops that can be opened now (always includes `current`). */
  reachable: ReadonlySet<CaptureStop>;
  onSelect: (stop: CaptureStop) => void;
}) {
  const currentIndex = STOP_ORDER.indexOf(current);
  return (
    <div
      role="tablist"
      aria-label="Menu photo to order page"
      className="flex flex-wrap items-center gap-1 border-b border-line-200"
    >
      {STOP_ORDER.map((stop, index) => {
        const status = journeyStepStatus(index, currentIndex);
        const open = reachable.has(stop);
        return (
          <button
            key={stop}
            type="button"
            role="tab"
            aria-selected={status === "current"}
            aria-current={status === "current" ? "step" : undefined}
            disabled={!open}
            onClick={() => {
              if (open) onSelect(stop);
            }}
            className={[
              "flex min-w-0 items-center gap-2 rounded-t-xl border-b-2 px-2.5 py-2 text-sm transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700",
              status === "current"
                ? "border-accent-700 font-semibold text-ink-900"
                : status === "done"
                  ? "border-transparent font-medium text-ink-700 hover:border-accent-300 hover:text-accent-900"
                  : "border-transparent font-medium text-ink-500",
              open && status !== "current" ? "cursor-pointer" : "",
              !open ? "cursor-not-allowed" : "",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className={[
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                status === "upcoming"
                  ? "border border-line-300 bg-surface-base text-ink-600"
                  : "bg-accent-700 text-on-accent",
              ].join(" ")}
            >
              {status === "done" ? "✓" : index + 1}
            </span>
            <span className="max-w-40 truncate">{JOURNEY_STEPS[index]}</span>
          </button>
        );
      })}
    </div>
  );
}

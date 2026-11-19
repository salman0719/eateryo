"use client";

import { JOURNEY_STEPS, journeyStepStatus } from "@/features/onboarding/journey";

/**
 * Capture's stop rail: the three-stop journey as the one control that moves
 * between stops. The passive `JourneySteps` tracker stays on the signed-out
 * front door and on the routed publish screen a magic link returns to; here
 * every stop the owner has reached is a button, so "go back to the photos" is
 * a visible control rather than a remembered route.
 *
 * A stop that has not been reached yet is disabled, not hidden: the rail is
 * also the answer to "how much is left", and a control that only appears once
 * it is usable reads as a different screen each time.
 *
 * A row, not tabs: the three stops are navigation and they span the screen,
 * each stop owning a third of it with the connector line running into the next
 * one. That needs the line to sit beside the button, which a tablist cannot
 * hold — so the semantics are `nav` + `aria-current="step"`, which is what the
 * levels actually are.
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
    <nav aria-label="Menu photo to order page" className="w-full">
      <ol className="flex w-full items-center">
        {STOP_ORDER.map((stop, index) => {
          const status = journeyStepStatus(index, currentIndex);
          const open = reachable.has(stop);
          return (
            <li key={stop} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                aria-current={status === "current" ? "step" : undefined}
                disabled={!open}
                onClick={() => {
                  if (open) onSelect(stop);
                }}
                className={[
                  "flex min-w-0 items-center gap-2 rounded-full px-2 py-1.5 text-sm transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700",
                  status === "current"
                    ? "bg-accent-100 font-semibold text-accent-900"
                    : status === "done"
                      ? "font-medium text-ink-700 hover:bg-surface-100 hover:text-accent-900"
                      : "font-medium text-ink-500",
                  open && status !== "current" ? "cursor-pointer" : "",
                  !open ? "cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    status === "upcoming"
                      ? "border border-line-300 bg-surface-base text-ink-600"
                      : "bg-accent-700 text-on-accent",
                  ].join(" ")}
                >
                  {status === "done" ? "✓" : index + 1}
                </span>
                <span className="min-w-0 truncate">{JOURNEY_STEPS[index]}</span>
              </button>
              {index < STOP_ORDER.length - 1 && (
                <span
                  aria-hidden="true"
                  className={[
                    "h-px min-w-3 flex-1 rounded-full",
                    index < currentIndex ? "bg-accent-300" : "bg-line-300",
                  ].join(" ")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

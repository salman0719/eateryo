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
 * the connector line taking up all the slack between one label and the next.
 * That needs the line to sit beside the button, which a tablist cannot hold —
 * so the semantics are `nav` + `aria-current="step"`, which is what the levels
 * actually are. Labels stay on one line and truncate rather than wrap: a
 * wrapped label puts the stops at different heights, which reads as broken.
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
          const last = index === STOP_ORDER.length - 1;
          return (
            <li
              key={stop}
              className={["flex min-w-0 items-center gap-2", last ? "shrink-0" : "grow"].join(" ")}
            >
              <button
                type="button"
                aria-current={status === "current" ? "step" : undefined}
                disabled={!open}
                onClick={() => {
                  if (open) onSelect(stop);
                }}
                className={[
                  "flex min-w-0 items-center gap-1.5 rounded-full px-1 py-1.5 text-xs transition-colors sm:gap-2 sm:px-2 sm:text-sm",
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
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold sm:h-6 sm:w-6 sm:text-[11px]",
                    status === "upcoming"
                      ? "border border-line-300 bg-surface-base text-ink-600"
                      : "bg-accent-700 text-on-accent",
                  ].join(" ")}
                >
                  {status === "done" ? "✓" : index + 1}
                </span>
                <span className="min-w-0 truncate whitespace-nowrap">{JOURNEY_STEPS[index]}</span>
              </button>
              {!last && (
                <span
                  aria-hidden="true"
                  className={[
                    "h-px min-w-1 flex-1 rounded-full sm:min-w-4",
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

"use client";

/**
 * The free-launch onboarding checklist (Step 11).
 *
 * Signed out, it still shows the whole list — every step open, and no state
 * claimed about an account we have not read — with the sign-in prompt above
 * it, so the "Get started" call to action lands on the process itself rather
 * than on a wall. Signed in, it reports the account's real state: five steps
 * are derived on the server, and the one step only a human can confirm
 * (printing table cards) is a labelled manual tick stored on this device.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchLaunchStatus } from "@/features/launch/client";
import { CARDS_PRINTED_KEY, cardsPrintedOnThisDevice } from "@/features/launch/progress";
import type { LaunchStatus } from "@/features/launch/schema";
import {
  launchSteps,
  previewLaunchSteps,
  verifiedProgress,
  type LaunchStep,
} from "@/features/launch/steps";
import { SyncError } from "@/features/menus/sync";
import { useWorkspace } from "@/features/tenancy/workspace-context";

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_cafe" }
  | { kind: "owner_only" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: LaunchStatus };

/** What the checklist read for one café — never for any other. */
type CafeState =
  | { kind: "loading" }
  | { kind: "owner_only" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: LaunchStatus };

function stepHref(step: LaunchStep): string {
  // Table cards belong to the restaurant, not to a menu: the Tables tab is
  // the only place that can print them for every open menu at once.
  if (step.id === "cards") return "/tables";
  // Orders start at a table card, which is printed from the same tab.
  if (step.id === "order") return "/tables";
  return "/";
}

function stepActionLabel(step: LaunchStep): string {
  switch (step.id) {
    case "extract":
      return "Upload a menu";
    case "review":
      return "Open the editor";
    case "cards":
      return "Open Tables";
    case "publish":
      return "Publish";
    case "order":
      return "Open Tables";
  }
}

/** The list before any account is read: every step open, no details shown. */
const SIGNED_OUT_STEPS = previewLaunchSteps();

/**
 * The five steps, in order. One list serves both audiences: signed in it
 * carries the account's real state and the manual print tick; signed out it
 * is the same process with every step open and no detail line, since there is
 * no café state to describe.
 */
function ChecklistSteps({
  steps,
  details,
  onToggleCards,
}: {
  steps: readonly LaunchStep[];
  /** Print each step's account state — never before an account has been read. */
  details: boolean;
  /** Present only signed in: the one tick only a human can give. */
  onToggleCards?: (next: boolean) => void;
}) {
  return (
    <ol className="mt-4 space-y-3">
      {steps.map((step, index) => {
        const showTick = step.manual && onToggleCards;
        return (
          <li key={step.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className={
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold " +
                (step.done
                  ? "border-accent-700 bg-accent-700 text-on-accent"
                  : "border-line-300 bg-surface-base text-ink-500")
              }
            >
              {step.done ? "✓" : index + 1}
            </span>
            <div className="min-w-0">
              <p
                className={
                  "text-sm font-medium " +
                  (step.done ? "text-ink-500 line-through" : "text-ink-900")
                }
              >
                {step.title}
              </p>
              <p className="mt-0.5 text-xs text-ink-600">{step.guidance}</p>
              {details ? <p className="mt-1 text-xs text-ink-500">{step.detail}</p> : null}
              {/* Manual steps keep their control after being ticked,
                  otherwise a mis-click could never be undone. */}
              {!step.done || showTick ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <Link
                    href={stepHref(step)}
                    className="text-xs font-semibold text-accent-800 underline underline-offset-2 hover:text-accent-900"
                  >
                    {stepActionLabel(step)}
                  </Link>
                  {showTick ? (
                    <label className="flex items-center gap-1.5 text-xs text-ink-600">
                      <input
                        type="checkbox"
                        checked={step.done}
                        onChange={(event) => onToggleCards?.(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-line-300 accent-accent-700"
                      />
                      {step.done ? "I printed them (untick to undo)" : "I printed them"}
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LaunchChecklist() {
  const workspace = useWorkspace();
  const [cafe, setCafe] = useState<{ for: string | null; state: CafeState }>({
    for: null,
    state: { kind: "loading" },
  });
  const [cardsPrinted, setCardsPrinted] = useState(false);
  /** Bumped by Try again: it re-reads the café and reloads in one pass. */
  const [attempt, setAttempt] = useState(0);
  const restaurantId = workspace.active?.restaurantId ?? null;

  // The checklist belongs to one membership: the shell's active café is the
  // only one this page asks about, and an answer for another café never shows.
  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchLaunchStatus(restaurantId);
        if (cancelled) return;
        // The manual tick is read in the browser, once the server data lands.
        setCardsPrinted(cardsPrintedOnThisDevice());
        setCafe({ for: restaurantId, state: { kind: "ready", status } });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof SyncError && error.code === "forbidden") {
          setCafe({ for: restaurantId, state: { kind: "owner_only" } });
          return;
        }
        setCafe({
          for: restaurantId,
          state: {
            kind: "error",
            message:
              error instanceof Error ? error.message : "Could not load your checklist. Try again.",
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, attempt]);

  const cafeState: CafeState = cafe.for === restaurantId ? cafe.state : { kind: "loading" };
  const state: State =
    workspace.sessionPending && !workspace.sessionCheckGaveUp
      ? { kind: "loading" }
      : workspace.sessionCheckGaveUp && !workspace.signedIn
        ? {
            kind: "error",
            message: "Could not check your sign-in. Check your connection and try again.",
          }
        : !workspace.signedIn
          ? { kind: "signed_out" }
          : workspace.pending
            ? { kind: "loading" }
            : workspace.failedFor !== null
              ? {
                  kind: "error",
                  message: "Could not load your cafés. Check your connection and try again.",
                }
              : !restaurantId
                ? { kind: "no_cafe" }
                : cafeState;

  function retry() {
    if (workspace.sessionCheckGaveUp) workspace.retrySession();
    if (workspace.failedFor !== null) workspace.refresh();
    setCafe({ for: restaurantId, state: { kind: "loading" } });
    setAttempt((current) => current + 1);
  }

  function toggleCardsPrinted(next: boolean) {
    setCardsPrinted(next);
    try {
      if (next) window.localStorage.setItem(CARDS_PRINTED_KEY, "yes");
      else window.localStorage.removeItem(CARDS_PRINTED_KEY);
    } catch {
      // Storage blocked: the tick still applies for this page view.
    }
  }

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        aria-busy="true"
        className="rounded-2xl border border-line-200 bg-surface-base p-5"
      >
        <span className="sr-only">Checking your account…</span>
        <Skeleton className="h-5 w-48" />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === "signed_out") {
    return (
      <section className="rounded-2xl border border-line-200 bg-surface-base p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">Your launch checklist</h2>
          <p className="text-xs text-ink-500">Sign in to start</p>
        </div>
        <div className="mt-3 rounded-xl border border-warning-200 bg-warning-50 p-3">
          <p className="text-sm text-warning-900">
            <span className="font-semibold text-warning-950">Nothing is ticked yet.</span> Your
            menus, publishing and table orders need an account so a phone at the table reaches the
            same menu your laptop published, and so the checklist keeps its place. It is still free,
            and there is no card step.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-in"
              className="rounded-lg bg-accent-800 px-3.5 py-2 text-sm font-semibold text-on-accent hover:bg-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Sign in with an email link
            </Link>
            <Link
              href="/"
              className="text-xs font-semibold text-accent-800 underline underline-offset-2 hover:text-accent-900"
            >
              Try the local editor first
            </Link>
          </div>
          <p className="mt-2 text-xs text-warning-900/80">
            Here, nothing leaves this browser and no account is needed.
          </p>
        </div>
        <ChecklistSteps steps={SIGNED_OUT_STEPS} details={false} />
      </section>
    );
  }

  if (state.kind === "no_cafe") {
    return (
      <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
        <h2 className="text-base font-semibold text-ink-900">No café to show yet</h2>
        <p className="mt-1 text-sm leading-6 text-ink-600">
          The checklist follows the café you are acting in. Capture a menu to start your own café,
          or open the invitation link from your email if you were invited to a team.
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex text-sm font-semibold text-accent-800 underline underline-offset-2 hover:text-accent-900"
        >
          Go to your workspace
        </Link>
      </div>
    );
  }

  if (state.kind === "owner_only") {
    return (
      <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
        <h2 className="text-base font-semibold text-ink-900">This checklist is the owner’s</h2>
        <p className="mt-1 text-sm leading-6 text-ink-600">
          The checklist follows the café you are acting in, and it belongs to that café’s owner.
          Helping at a café gives you its menus, tables and orders — not its launch steps. If you
          run your own café, switch to it in the workspace switcher and open this page again.
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex text-sm font-semibold text-accent-800 underline underline-offset-2 hover:text-accent-900"
        >
          Go to your workspace
        </Link>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-2xl border border-danger-200 bg-danger-50 p-5">
        <h2 className="text-base font-semibold text-danger-900">The checklist could not load</h2>
        <p className="mt-1 text-sm text-danger-800">{state.message}</p>
        <button
          type="button"
          onClick={() => void retry()}
          className="mt-3 rounded-lg border border-danger-300 bg-surface-base px-3 py-1.5 text-sm font-medium text-danger-800 hover:bg-danger-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-600"
        >
          Try again
        </button>
      </div>
    );
  }

  // The signed-out render above is the only way a loading state survives the
  // guards, so anything else here is settled.
  if (state.kind !== "ready") return null;

  const { status } = state;
  const steps = launchSteps(status).map((step) =>
    step.manual ? { ...step, done: cardsPrinted } : step
  );
  const progress = verifiedProgress(steps);
  const allDone = steps.every((step) => step.done);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line-200 bg-surface-base p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">Your launch checklist</h2>
          <p className="text-xs text-ink-500">
            {progress.done} of {progress.total} steps we can verify
            {cardsPrinted ? " · table cards ticked" : ""}
          </p>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-100"
          role="img"
          aria-label={`${progress.done} of ${progress.total} verifiable steps complete`}
        >
          <div
            className="h-full rounded-full bg-accent-700 transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>

        <ChecklistSteps steps={steps} details onToggleCards={toggleCardsPrinted} />

        {allDone ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-100 px-3 py-2 text-xs text-ink-700">
            <span
              aria-hidden="true"
              className="mt-1 size-1.5 shrink-0 rounded-full bg-success-700"
            />
            That is the whole launch. New orders appear on the Orders tab, and the public page keeps
            showing your latest published menu.
          </p>
        ) : null}
      </section>
    </div>
  );
}

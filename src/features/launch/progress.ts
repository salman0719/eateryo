/**
 * Launch checklist progress for the surfaces outside `/launch` — today the
 * sidebar's "Launch checklist" row.
 *
 * The count is derived exactly as the checklist page derives it: the four
 * server-verified steps plus the one manual tick for printing table cards,
 * read from this device. Keeping the rule here means the sidebar and the
 * page can never disagree about how far along the owner is.
 */

import type { LaunchSnapshot } from "./schema";
import { launchSteps } from "./steps";

/** The one step only a human can confirm (printing table cards). */
export const CARDS_PRINTED_KEY = "eateryo:launch:cards-printed";

export interface LaunchProgress {
  done: number;
  total: number;
  /** Every step is done: the row has nothing left to point at. */
  complete: boolean;
}

/** Did the owner tick "I printed the table cards" on this device? */
export function cardsPrintedOnThisDevice(): boolean {
  try {
    return window.localStorage.getItem(CARDS_PRINTED_KEY) === "yes";
  } catch {
    return false;
  }
}

export function launchProgress(snapshot: LaunchSnapshot, cardsPrinted: boolean): LaunchProgress {
  const steps = launchSteps(snapshot).map((step) =>
    step.manual ? { ...step, done: cardsPrinted } : step
  );
  const done = steps.filter((step) => step.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

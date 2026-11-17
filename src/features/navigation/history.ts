/**
 * The one decision navigation makes about the browser history, kept pure so
 * it can be reasoned about (and tested) without a DOM: given where the app is
 * and where it is going, record the move or not.
 */

export type HistoryWrite = "push" | "replace" | "none";

/**
 * Same URL means nothing to record — the screen may still change (an editor
 * mode switch that normalises the path), and a back entry for it would be a
 * step that goes nowhere. A replacement never grows the back stack, which is
 * what guards and redirects need: nobody should be able to press Back into a
 * surface they were just moved off.
 */
export function historyWriteFor(input: {
  currentHref: string;
  nextHref: string;
  replace: boolean;
}): HistoryWrite {
  if (input.currentHref === input.nextHref) return "none";
  return input.replace ? "replace" : "push";
}

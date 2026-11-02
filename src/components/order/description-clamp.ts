/**
 * The diner row's description ceiling (009).
 *
 * A description arrives as long as the menu photo was wordy — extraction
 * preserves the source, the schema has no limit, and the editor has no cap —
 * so a paragraph under one dish turns a scannable list into a wall of text:
 * rows stop lining up, and the size picker and Add button drift far below the
 * name and price they belong to.
 *
 * The fix is render-side and honest: clamp to two lines and *offer* the rest,
 * never truncate it. Ingredient and allergen notes live in these strings, so
 * a diner who cannot reach "contains nuts" would be a safety problem, not a
 * styling one. The decisions are here, away from JSX, so they can be tested
 * without a browser: the repo has no DOM test environment, and a class name
 * alone proves nothing about when the control appears.
 */

/** Two lines: enough for an ingredient note, not for a paragraph. */
export const DESCRIPTION_CLAMP_CLASS = "line-clamp-2";

/** The parts of a rendered box the clamp decision needs. */
export interface ClampBox {
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Is the clamped description actually hiding text?
 *
 * A box with no height is *unmeasured* — jsdom reports zero for both, and a
 * row that has not been laid out yet does too — and an unmeasured row must
 * never show a control that does nothing. The 1px slack absorbs sub-pixel
 * rounding, which would otherwise offer "More" for text that already fits.
 */
export function hidesClampedText(box: ClampBox | null | undefined): boolean {
  if (!box || box.clientHeight <= 0) return false;
  return box.scrollHeight > box.clientHeight + 1;
}

export interface DescriptionToggle {
  /** Render the control at all. */
  show: boolean;
  /** What it says next. */
  label: "More" | "Less";
  /** Whether the description is currently open. */
  expanded: boolean;
}

/**
 * The control appears only when there is more to read, and *stays* while the
 * text is open: unclamping makes the box fit its content again, so a decision
 * based on overflow alone would remove the only way to collapse it.
 */
export function descriptionToggle(expanded: boolean, overflowing: boolean): DescriptionToggle {
  return { show: expanded || overflowing, label: expanded ? "Less" : "More", expanded };
}

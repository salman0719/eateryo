/**
 * The single offline menu rule.
 *
 * Signed-out work is one draft, not a library: the browser holds at most
 * one menu until its owner signs in to publish it. Anything that would mint
 * a second browser-only menu (a fresh capture, demo, blank menu, or JSON
 * import) must either replace the existing one with explicit consent or be
 * refused with a next step. Signed-in work is never limited here — an owner
 * with a café creates cloud copies instead (see `serverCaptureTarget` in
 * the shell).
 */

/** Refusal copy for additive actions (New, Import) when the slot is full. */
export const SIGNED_OUT_SINGLE_MENU_MESSAGE =
  "You already have a menu in this browser — open it from My menus, or sign in to publish it, before starting another.";

/** Replacement consent for flow actions (capture, demo) when the slot is full. */
export const SIGNED_OUT_REPLACE_MESSAGE =
  "You already have a menu in this browser. Starting a new one will replace it. Continue?";

/**
 * True when a signed-out browser already holds its one menu, so starting
 * another needs consent (capture/demo) or is refused (New/Import).
 */
export function signedOutSlotFull(input: { signedIn: boolean; libraryCount: number }): boolean {
  return !input.signedIn && input.libraryCount > 0;
}

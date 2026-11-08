/**
 * Which library rows belong to the café the shell is acting in.
 *
 * A server menu names its restaurant, so it is listed only while that café is
 * the active membership. A browser-only draft names no café: it belongs to a
 * context that can write one — the owner's — and is hidden on a staff shift,
 * which never creates drafts.
 *
 * `known` is the third state. Before the account's menu list has answered (or
 * after the read failed) the map says nothing about the rows, so every row is
 * kept: a loading shell skeletons rather than quietly emptying the library,
 * and a failed read never hides a row on a guess.
 *
 * Pure and client-safe, so the rule is unit-tested without a browser.
 */
export interface CafeScopeInput {
  menuIds: readonly string[];
  /** The café each server menu belongs to, keyed by menu id. */
  restaurantById: ReadonlyMap<string, string>;
  /** The active membership's café; null before one exists (a new account). */
  restaurantId: string | null;
  /** The active membership can create drafts (`menus.write`). */
  canWrite: boolean;
  /** The account's menu list has answered successfully. */
  known: boolean;
}

export function scopeMenusToCafe(input: CafeScopeInput): string[] {
  if (!input.known) return [...input.menuIds];
  return input.menuIds.filter((id) => {
    const restaurantId = input.restaurantById.get(id);
    if (restaurantId) return restaurantId === input.restaurantId;
    return input.canWrite;
  });
}
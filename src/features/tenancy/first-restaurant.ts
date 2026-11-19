/**
 * Creating an account's first café is one decision, made from several places:
 * the publish-journey claim (the magic link returning a signed-out owner), the
 * generic sign-in import, and the editor's autosave when a menu must be filed
 * and no café is known yet. Each used to call `POST /api/restaurants` itself
 * after reading "this account owns nothing", so two of them firing in the same
 * moment — the journey claim and the generic import both ran on the first
 * signed-in render — raced the server's check-then-insert and minted two
 * cafés on a brand-new account.
 *
 * This module is the one door for that decision:
 *
 * - Concurrent callers for one account share a single in-flight attempt, so a
 *   race inside this tab cannot become two requests.
 * - It re-reads the account's owned cafés before creating, so a café another
 *   path just made is adopted instead of duplicated.
 * - A create that loses a race (`conflict`, the server's 409) adopts the
 *   winner instead of failing.
 *
 * It deliberately does not enforce a database-level "one café per account":
 * owning several cafés may come back, and the rule would then have to be
 * lifted from every existing row. The account-scoped single flight covers
 * every path the app itself has; two tabs creating at once remain the one
 * case only a constraint could settle.
 */

import { SyncError } from "@/features/menus/sync";

import { createRestaurant, fetchRestaurants, type RestaurantOption } from "./client";

/** What the first-café decision needs from the outside; injected for tests. */
export interface FirstRestaurantDeps {
  /** Cafés this account owns right now (fresh read, not a cached list). */
  listOwned(): Promise<RestaurantOption[]>;
  /** Create one, returning what the server answered. */
  create(name: string): Promise<RestaurantOption>;
}

const defaultDeps: FirstRestaurantDeps = {
  listOwned: async () =>
    (await fetchRestaurants()).filter((restaurant) => restaurant.role === "owner"),
  create: (name) => createRestaurant(name),
};

/**
 * One in-flight creation per account, shared by every caller in this tab.
 * Removed when the attempt settles so a retry after a failure creates again.
 */
const inFlight = new Map<string, Promise<RestaurantOption>>();

/** The owned café a concurrent create already produced, if any. */
function firstOwned(restaurants: readonly RestaurantOption[]): RestaurantOption | null {
  return restaurants[0] ?? null;
}

async function createOnce(name: string, deps: FirstRestaurantDeps): Promise<RestaurantOption> {
  // A failed read is not "the account owns nothing", but it cannot be allowed
  // to block filing: fall through to the create, whose 409 handling below
  // recovers the café that made the pre-read stale.
  const owned = await deps.listOwned().catch(() => [] as RestaurantOption[]);
  const existing = firstOwned(owned);
  if (existing) return existing;

  try {
    return await deps.create(name);
  } catch (error) {
    if (error instanceof SyncError && error.code === "conflict") {
      // Another path won the race between our read and our insert: adopt it.
      const after = await deps.listOwned().catch(() => [] as RestaurantOption[]);
      const raced = firstOwned(after);
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * The account's first café: an owned one when it already has it, otherwise a
 * newly created one. Callers in the same tab asking at the same moment get
 * the same promise, so only one request is ever on the wire.
 */
export function ensureFirstRestaurant(
  accountKey: string,
  name: string,
  deps: FirstRestaurantDeps = defaultDeps
): Promise<RestaurantOption> {
  const running = inFlight.get(accountKey);
  if (running) return running;

  const attempt = createOnce(name, deps).finally(() => {
    if (inFlight.get(accountKey) === attempt) inFlight.delete(accountKey);
  });
  inFlight.set(accountKey, attempt);
  return attempt;
}

/** Drop every in-flight attempt. Tests only: module state outlives a case. */
export function resetFirstRestaurantFlights(): void {
  inFlight.clear();
}

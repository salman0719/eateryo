import type { Order } from "./schema";

/**
 * R0 app-wide order monitor (report 5, tiers 0+1): pure list helpers shared
 * by the provider and its tests.
 *
 * `mergeBoardOrders` folds an incremental read into the board: guarded ids
 * (a status PATCH in flight) are never overwritten by a poll, and the board
 * stays newest-first. `detectNewOrders` picks the arrivals worth shouting
 * about — status `new` and created after the last seen moment — so the
 * initial load and status edits never toast.
 */

export function mergeBoardOrders(
  current: Order[],
  incoming: Order[],
  guardedIds: ReadonlySet<string>
): Order[] {
  const byId = new Map(current.map((order) => [order.id, order]));
  for (const order of incoming) {
    if (guardedIds.has(order.id)) continue;
    byId.set(order.id, order);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function detectNewOrders(incoming: Order[], seenAt: string | null): Order[] {
  return incoming.filter(
    (order) => order.status === "new" && (seenAt === null || order.createdAt > seenAt)
  );
}

/**
 * The one membership the monitor acts in. This key is the reset key: a
 * different account, or the same account switching between an owned café and
 * a staff shift, must wipe the previous board rather than merge two
 * memberships' tickets.
 */
export function monitorScopeKey(userId: string | null, restaurantId: string | null): string {
  return `${userId ?? ""}::${restaurantId ?? ""}`;
}

export type MonitorPollScope =
  | { kind: "signed-out" }
  /** The membership read has not answered; polling would ask for the union. */
  | { kind: "membership-pending" }
  | { kind: "no-cafe" }
  | { kind: "active"; restaurantId: string };

/**
 * What the poller may do right now. Only `active` carries a café, so a poll
 * cannot be sent without one: the server would answer with every membership.
 */
export function monitorPollScope(input: {
  userId: string | null;
  restaurantId: string | null;
  pending: boolean;
}): MonitorPollScope {
  if (!input.userId) return { kind: "signed-out" };
  if (input.pending) return { kind: "membership-pending" };
  if (!input.restaurantId) return { kind: "no-cafe" };
  return { kind: "active", restaurantId: input.restaurantId };
}

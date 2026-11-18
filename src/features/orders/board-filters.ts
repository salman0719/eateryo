/**
 * Pure helpers for the staff orders Kanban board (prototype B).
 *
 * The board segregates New / Preparing / Done so a new ticket can never hide
 * inside history, and defaults to the last 24 hours so yesterday's tickets do
 * not crowd out today's. All time math takes an explicit `now` so tests can
 * pin it; the UI passes `Date.now()`.
 */

import { orderCode, type Order } from "./schema";

export type BoardWindow = "24h" | "all";

export const BOARD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Minutes before a `new` ticket reads as hot on the board. */
export const NEW_HOT_MINUTES = 20;

export interface BoardFilter {
  window: BoardWindow;
  query: string;
  hideDone: boolean;
  /**
   * Table labels hidden via the Tables dropdown. The text search never
   * matches tables (dish + #code only) — this list is the only table filter.
   */
  excludedTables?: string[];
}

export function isInBoardWindow(order: Order, window: BoardWindow, now: number): boolean {
  if (window === "all") return true;
  const created = new Date(order.createdAt).getTime();
  if (Number.isNaN(created)) return true;
  return now - created <= BOARD_WINDOW_MS;
}

export function matchesBoardSearch(order: Order, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  // Dish names + short code only — tables are filtered via the Tables
  // dropdown (excludedTables), never via text search.
  const haystack = [orderCode(order.id), ...order.lines.map((line) => line.name)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** Sorted unique table labels across the loaded orders, for the dropdown. */
export function distinctBoardTables(orders: readonly Order[]): string[] {
  const seen = new Set<string>();
  for (const order of orders) seen.add(order.tableLabel);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function filterBoardOrders(
  orders: readonly Order[],
  filter: BoardFilter,
  now: number = Date.now()
): Order[] {
  const excluded = filter.excludedTables?.length ? new Set(filter.excludedTables) : null;
  return orders.filter(
    (order) =>
      isInBoardWindow(order, filter.window, now) &&
      (excluded === null || !excluded.has(order.tableLabel)) &&
      matchesBoardSearch(order, filter.query) &&
      !(filter.hideDone && (order.status === "served" || order.status === "cancelled"))
  );
}

export interface GroupedBoardOrders {
  fresh: Order[];
  preparing: Order[];
  done: Order[];
}

/** New owns a column; Done holds served + cancelled together. */
export function groupBoardOrders(orders: readonly Order[]): GroupedBoardOrders {
  const fresh: Order[] = [];
  const preparing: Order[] = [];
  const done: Order[] = [];
  for (const order of orders) {
    if (order.status === "new") fresh.push(order);
    else if (order.status === "preparing") preparing.push(order);
    else done.push(order);
  }
  return { fresh, preparing, done };
}

/** Short elapsed label: "just now", "4m", "2h 5m". */
export function formatElapsed(iso: string, now: number = Date.now()): string {
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return "";
  const minutes = Math.max(0, Math.round((now - created) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function isNewHot(order: Order, now: number = Date.now()): boolean {
  if (order.status !== "new") return false;
  const created = new Date(order.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now - created >= NEW_HOT_MINUTES * 60000;
}

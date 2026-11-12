"use client";

/**
 * The screen a diner lands on once their order is in.
 *
 * It is its own surface on purpose, and its own file: every ordering flow
 * (the multi-menu table landing, the single published menu, and the
 * browser-only prototype) shows exactly this after sending, and this is where
 * the receipt will grow — status, an estimated time, the ticket itself. It
 * must never borrow the ordering page's chrome: "Order from your table" and
 * "2 menus are open" describe a page whose job is done.
 *
 * Only facts the order carries are shown: the code, the table, how many
 * dishes, and the total (an em dash when any dish had no price, never a
 * guessed number).
 */

import type { ReactNode } from "react";

import { orderCode, orderItemCountLabel, orderTotal, type Order } from "@/features/orders/schema";
import { formatTableLabel } from "@/features/orders/table-links";

import { formatOrderTotal } from "./order-menu";

export interface OrderReceivedProps {
  order: Order;
  /** The café the table belongs to, when the flow knows it. */
  restaurantName?: string | null;
  /** What happens next, in this flow's own words. */
  footnote: string;
  /** Send the diner back to the menu. */
  onOrderAgain: () => void;
  /**
   * Slot under the summary for the detail this screen will grow into (status,
   * timing, the ticket). Empty today, so no route has to change to fill it.
   */
  children?: ReactNode;
}

export function OrderReceived({
  order,
  restaurantName,
  footnote,
  onOrderAgain,
  children,
}: OrderReceivedProps) {
  const where = formatTableLabel(order.tableLabel);

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-base p-8 text-center">
      <p className="text-sm font-semibold tracking-wider text-success-800 uppercase">
        Order received
      </p>
      <p className="mt-3 text-2xl font-bold text-ink-900">#{orderCode(order.id)}</p>
      <p className="mt-1 text-sm text-ink-600">
        {restaurantName ? `${restaurantName} · ${where}` : where}
      </p>
      <p className="mt-2 text-sm text-ink-600">
        {orderItemCountLabel(order.lines)} ·{" "}
        {formatOrderTotal(order.currency, orderTotal(order.lines))}
      </p>
      <p className="mx-auto mt-4 max-w-md text-xs leading-5 text-ink-500">{footnote}</p>

      {children}

      <button
        type="button"
        onClick={onOrderAgain}
        className="mt-5 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        Order something else
      </button>
    </div>
  );
}

"use client";

import { OrdersBoard } from "@/components/orders/orders-board";

/**
 * Orders: the board picks its own source (server when signed in, the local
 * queue otherwise), so the page needs nothing from the shell.
 */
export function OrdersPage() {
  return <OrdersBoard />;
}

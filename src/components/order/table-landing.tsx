"use client";

/**
 * The table landing screen: `/r/<restaurant>/t/<table>`.
 *
 * It owns the one piece of state that moves the page on — the order just sent
 * — because the confirmation is a different screen, not a section of the
 * ordering page. Before the order, the heading describes what is being served
 * and the tabs do the ordering; after it, the heading would be a lie ("2 menus
 * are open") and the diner gets `OrderReceived` alone.
 *
 * The copy and the frame live here rather than in the route so the route can
 * stay a server component that only reads the landing.
 */

import { useState } from "react";

import { formatTableLabel } from "@/features/orders/table-links";
import type { Order } from "@/features/orders/schema";

import { OrderShell } from "./order-menu";
import { OrderReceived } from "./order-received";
import { TableOrderTabs, type ClosedTableOrderMenu, type TableOrderMenu } from "./table-order-tabs";

export interface TableLandingProps {
  restaurantName: string;
  restaurantSlug: string;
  tableLabel: string;
  menus: TableOrderMenu[];
  closedMenus: ClosedTableOrderMenu[];
}

/** What the heading says about this visit, in the diner's terms. */
function landingSummary(menus: TableOrderMenu[], closedMenus: ClosedTableOrderMenu[]): string {
  if (menus.length === 0) {
    return closedMenus.length === 1
      ? "Nothing is being served right now — opening hours are below."
      : "Nothing is being served right now — tap a menu to see when it opens.";
  }
  if (menus.length === 1) return "Here’s what’s on — tap a dish to add it.";
  return `${menus.length} menus are open — browse the tabs or search them all at once.`;
}

export function TableLanding({
  restaurantName,
  restaurantSlug,
  tableLabel,
  menus,
  closedMenus,
}: TableLandingProps) {
  const [placed, setPlaced] = useState<Order | null>(null);
  const frame = "rounded-2xl border border-line-200 bg-surface-base";

  if (placed) {
    return (
      <OrderShell tableLabel={placed.tableLabel}>
        <OrderReceived
          order={placed}
          restaurantName={restaurantName}
          footnote="The kitchen sees this on their board right away. The total is confirmed when your order is prepared."
          onOrderAgain={() => setPlaced(null)}
        />
      </OrderShell>
    );
  }

  return (
    <OrderShell tableLabel={tableLabel}>
      <div className={`${frame} p-5`}>
        <p className="text-sm font-semibold tracking-wider text-accent-700 uppercase">
          {restaurantName} · {formatTableLabel(tableLabel)}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900">Order from your table</h1>
        <p className="mt-1 text-sm text-ink-600">{landingSummary(menus, closedMenus)}</p>
      </div>

      <TableOrderTabs
        restaurantName={restaurantName}
        restaurantSlug={restaurantSlug}
        tableLabel={tableLabel}
        menus={menus}
        closedMenus={closedMenus}
        onPlaced={setPlaced}
      />
    </OrderShell>
  );
}

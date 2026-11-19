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

import { useEffect, useState } from "react";

import { fetchTrackedOrder, type PlacedOrder } from "@/features/orders/client";

import { DinerCoverHeader, OrderShell, OrderSkeleton } from "./order-menu";
import { OrderReceived } from "./order-received";
import { OrderTracker } from "./order-tracker";
import { TableOrderTabs, type ClosedTableOrderMenu, type TableOrderMenu } from "./table-order-tabs";

export interface TableLandingProps {
  restaurantName: string;
  restaurantSlug: string;
  tableLabel: string;
  menus: TableOrderMenu[];
  closedMenus: ClosedTableOrderMenu[];
  /**
   * The reloadable order token from `?track=`, read server-side so the
   * first paint already knows a resume is coming. While it resolves the
   * page shows a neutral loading state — never the ordering UI, which
   * would flash and vanish once the confirmation arrives.
   */
  resumeToken: string | null;
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
  resumeToken,
}: TableLandingProps) {
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [resolving, setResolving] = useState(resumeToken !== null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const frame = "rounded-2xl border border-line-200 bg-surface-base";

  // A shared table link (`?track=`) resumes the tracker after a reload.
  // The token arrives as a prop (read server-side), so the first paint is
  // already the loading state — the ordering UI never flashes underneath.
  useEffect(() => {
    if (!resumeToken) return;
    let cancelled = false;
    const token = resumeToken;
    void (async () => {
      try {
        const result = await fetchTrackedOrder(token);
        if (cancelled) return;
        setPlaced({ order: result.order, tracking: { token, expiresAt: result.serverTime } });
      } catch {
        if (cancelled) return;
        setResumeError("That order link is no longer valid. Ask staff to check your order.");
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeToken]);

  if (resolving) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <OrderSkeleton label="Finding your order…" />
      </OrderShell>
    );
  }

  if (placed) {
    return (
      <OrderShell tableLabel={placed.order.tableLabel}>
        <OrderReceived
          order={placed.order}
          restaurantName={restaurantName}
          footnote="The kitchen sees this on their board right away. The total is confirmed when your order is prepared."
          onOrderAgain={() => setPlaced(null)}
        >
          <OrderTracker
            orderId={placed.order.id}
            token={placed.tracking?.token ?? null}
            initialOrder={placed.order}
            restaurantName={restaurantName}
          />
        </OrderReceived>
      </OrderShell>
    );
  }

  if (resumeError) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-lg font-semibold text-ink-900">This order link is no longer valid</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">{resumeError}</p>
        </div>
      </OrderShell>
    );
  }

  return (
    <OrderShell tableLabel={tableLabel}>
      <DinerCoverHeader
        restaurantName={restaurantName}
        subline={landingSummary(menus, closedMenus)}
      />

      <TableOrderTabs
        restaurantName={restaurantName}
        restaurantSlug={restaurantSlug}
        tableLabel={tableLabel}
        menus={menus}
        closedMenus={closedMenus}
        onPlaced={(next) => {
          setPlaced(next);
          if (next.tracking) {
            const url = new URL(window.location.href);
            url.searchParams.set("track", next.tracking.token);
            window.history.replaceState(null, "", url.toString());
          }
        }}
      />
    </OrderShell>
  );
}

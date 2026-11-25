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

import type { BrandAssetImage } from "@/features/brand-assets/schema";
import { fetchTrackedOrder, type PlacedOrder } from "@/features/orders/client";

import { DinerCoverHeader, DinerSplash } from "./order-menu";
import { OrderPaySection } from "./order-pay-section";
import { OrderReceived } from "./order-received";
import { OrderTracker } from "./order-tracker";
import { TableOrderTabs, type ClosedTableOrderMenu, type TableOrderMenu } from "./table-order-tabs";

export interface TableLandingProps {
  restaurantName: string;
  restaurantSlug: string;
  /** Brand assets; the header falls back to gradient + initial without. */
  restaurantLogo?: BrandAssetImage | null;
  restaurantCover?: BrandAssetImage | null;
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
  /** Stripe return state (`?pay=success&session_id=…`), also server-read. */
  returnPay: "success" | "cancelled" | null;
  returnSessionId: string | null;
}

/**
 * The ordering flow inside the table landing: the resolving/placed/error
 * states and the cover + menu tabs. The route renders this under one
 * `DinerThemeProvider` — the identity row arrives before the menus stream
 * in — so the theme is a property of the visit, not of one section, and
 * the first paint is already themed. Portalled sheets re-apply the same
 * vars from context (see `diner-theme.tsx`).
 */
export function TableLandingBody({
  restaurantName,
  restaurantSlug,
  restaurantLogo = null,
  restaurantCover = null,
  tableLabel,
  menus,
  closedMenus,
  resumeToken,
  returnPay,
  returnSessionId,
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
    return <DinerSplash label="Finding your order…" />;
  }

  if (placed) {
    // Option A (hide-until-paid): a card ticket stays off the kitchen board
    // until payment completes, so the footnote must not promise the kitchen
    // already has it. Counter tickets keep the old promise.
    const needsCard =
      placed.order.paymentProvider === "stripe" &&
      placed.order.paymentStatus !== "paid" &&
      placed.order.paymentStatus !== "refunded";
    return (
      <OrderReceived
        order={placed.order}
        restaurantName={restaurantName}
        footnote={
          needsCard
            ? "Complete payment below — the kitchen starts your order once payment goes through."
            : "The kitchen sees this on their board right away. The total is confirmed when your order is prepared."
        }
        onOrderAgain={() => setPlaced(null)}
      >
        <OrderPaySection
          orderId={placed.order.id}
          trackingToken={placed.tracking?.token ?? null}
          returnPay={returnPay}
          sessionId={returnSessionId}
        />
        <OrderTracker
          orderId={placed.order.id}
          token={placed.tracking?.token ?? null}
          initialOrder={placed.order}
          restaurantName={restaurantName}
        />
      </OrderReceived>
    );
  }

  if (resumeError) {
    return (
      <div className={`${frame} p-8 text-center`}>
        <p className="text-lg font-semibold text-ink-900">This order link is no longer valid</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">{resumeError}</p>
      </div>
    );
  }

  // The cover names the restaurant and the table only — no helper copy.
  // When nothing is served, the empty-state card below the tabs says so
  // where the opening hours already live, not in the header.
  return (
    <>
      <DinerCoverHeader
        restaurantName={restaurantName}
        tableLabel={tableLabel}
        logo={restaurantLogo}
        cover={restaurantCover}
        bleed
        eagerMedia
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
    </>
  );
}

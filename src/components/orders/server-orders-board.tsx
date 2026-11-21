"use client";

/**
 * Staff order board backed by the server (Step 10). Orders placed from a
 * public table link on another device appear here without a manual refresh.
 *
 * Polling, not websockets: the first load fetches the newest orders, then a
 * 5-second loop asks for everything changed since the last server timestamp —
 * so status edits from another device arrive the same way new orders do. A
 * failed poll doubles the wait up to 40 seconds and the header says
 * "Reconnecting" with the last successful sync, instead of looking live
 * while it is not.
 *
 * Status changes are optimistic: the card moves immediately, the PATCH carries
 * the `updatedAt` we last saw, and any failure rolls the card back and says
 * why. A 409 means another device changed it first — the board refreshes and
 * adopts the server's version rather than overwriting.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { orderCode, orderTotal, type Order, type OrderStatus } from "@/features/orders/schema";
import { formatElapsed } from "@/features/orders/board-filters";
import { GuidanceCard } from "@/components/ui/guidance-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { checkOrderPayment, fetchAwaitingPayment, setOrderStatus } from "@/features/orders/client";
import { useOrderMonitor } from "@/features/orders/monitor";
import {
  normalizePaymentStatus,
  paymentStatusLabel,
  paymentStatusTone,
} from "@/features/payments/status-view";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { useWorkspace } from "@/features/tenancy/workspace-context";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "@/features/orders/table-links";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { KanbanBoard } from "@/components/orders/kanban-board";

/**
 * Loading placeholder shared by both boards: pulsing ticket cards in the
 * shape the real ones land in, so the list does not jump when they arrive.
 */
export function OrdersSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading orders…</span>
      <ul className="space-y-3">
        {[0, 1, 2].map((row) => (
          <li key={row} className="rounded-2xl border border-line-200 bg-surface-base p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-3 h-3 w-2/5" />
            <Skeleton className="mt-2 h-3 w-1/3" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorMessage(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "unauthorized":
        return "Your session expired — sign in again to keep the board live.";
      case "forbidden":
        return "You don't have access to this restaurant's orders.";
      case "not_found":
        return "That order no longer exists.";
      case "rate_limited":
        return error.message;
      default:
        return error.message;
    }
  }
  return "Could not reach the server. Check your connection.";
}

export function ServerOrdersBoard() {
  const { confirm, dialog } = useConfirm();
  // The poller lives in the app-wide monitor (shared cursor with the tab
  // badge and toasts); the board only guards its own optimistic writes.
  const {
    orders,
    phase,
    connection,
    lastSyncedAt,
    pollError,
    soundOn,
    setSoundOn,
    hasArrived,
    notificationsAvailable,
    notificationPermission,
    requestNotifications,
    historyWindow,
    setHistoryWindow,
    counts,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
    applyOptimistic,
    resolveOptimistic,
    revertOptimistic,
  } = useOrderMonitor();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<{ orderId: string; text: string } | null>(null);
  // Option A strip: card tickets the board hides until paid. Empty for
  // cash-only cafés — the strip then renders nothing.
  const { active } = useWorkspace();
  const restaurantId = active?.restaurantId ?? null;
  const [awaitingOrders, setAwaitingOrders] = useState<Order[]>([]);
  const [awaitingLoading, setAwaitingLoading] = useState(false);
  // Collapsed by default: the strip costs one small pill until staff
  // expand it — no wasted rows when card tickets are waiting.
  const [awaitingOpen, setAwaitingOpen] = useState(false);
  // Lazy auto-reconcile: each pending/failed ticket is checked once per
  // list — a missed webhook then heals itself without staff clicking.
  const autoTriedRef = useRef<Set<string>>(new Set());

  const loadAwaiting = useCallback(async () => {
    if (!restaurantId) {
      setAwaitingOrders([]);
      return;
    }
    setAwaitingLoading(true);
    try {
      const result = await fetchAwaitingPayment({ restaurantId });
      setAwaitingOrders(result.orders);
    } catch {
      // The board stays the truth; a strip failure never blocks the kitchen.
    } finally {
      setAwaitingLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    autoTriedRef.current = new Set();
    // Deferred so the effect body never sets state synchronously: the
    // strip fills in after paint, like the monitor's own first poll.
    const timer = setTimeout(() => void loadAwaiting(), 0);
    return () => clearTimeout(timer);
  }, [loadAwaiting]);

  const refreshAll = useCallback(() => {
    refresh();
    void loadAwaiting();
  }, [refresh, loadAwaiting]);

  useEffect(() => {
    const candidates = awaitingOrders
      .filter(
        (order) =>
          (order.paymentStatus === "pending" || order.paymentStatus === "failed") &&
          !autoTriedRef.current.has(order.id)
      )
      .slice(0, 10);
    if (candidates.length === 0) return;
    for (const order of candidates) autoTriedRef.current.add(order.id);
    void (async () => {
      let anyPaid = false;
      for (const order of candidates) {
        try {
          const result = await checkOrderPayment(order.id);
          if (result.reconciled) anyPaid = true;
        } catch {
          // Manual "Check payment" remains; auto never nags.
        }
      }
      if (anyPaid) refreshAll();
      else void loadAwaiting();
    })();
  }, [awaitingOrders, loadAwaiting, refreshAll]);

  async function move(order: Order, target: OrderStatus) {
    if (busyId) return;
    setBusyId(order.id);
    setError(null);
    applyOptimistic(order.id, target);
    try {
      const updated = await setOrderStatus(order.id, target, order.updatedAt);
      resolveOptimistic(updated);
    } catch (updateError) {
      revertOptimistic(order);
      if (updateError instanceof SyncError && updateError.code === "conflict") {
        setError("That order changed elsewhere — showing the latest version.");
        refresh();
      } else {
        setError(errorMessage(updateError));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(order: Order) {
    const ok = await confirm({
      message: `Cancel order #${orderCode(order.id)} for ${formatTableLabel(order.tableLabel)}?`,
      confirmLabel: "Cancel order",
      destructive: true,
    });
    if (!ok) return;
    void move(order, "cancelled");
  }

  /** Missed-webhook reconciliation: read the session off the café's account. */
  async function checkPayment(order: Order) {
    if (checkingId) return;
    setCheckingId(order.id);
    setCheckNote(null);
    setError(null);
    try {
      const result = await checkOrderPayment(order.id);
      if (result.reconciled) {
        refreshAll();
        setCheckNote({ orderId: order.id, text: "Payment confirmed — the board now shows Paid." });
      } else {
        setCheckNote({
          orderId: order.id,
          text: "Stripe shows no payment yet — the confirmation may still arrive. Try again in a minute.",
        });
      }
    } catch (checkError) {
      setCheckNote({
        orderId: order.id,
        text:
          checkError instanceof SyncError
            ? checkError.message
            : "Could not reach Stripe. Try again.",
      });
    } finally {
      setCheckingId(null);
    }
  }

  const openCount = orders.filter((order) => order.status === "new").length;
  const activeCount = orders.filter(
    (order) => order.status === "new" || order.status === "preparing"
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">Orders</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            {orders.length === 0 && !counts
              ? "Orders placed from public table links appear here."
              : `${counts ? `${counts.total.toLocaleString()} in ${historyWindow === "24h" ? "the last 24h" : "all time"} · ` : ""}${activeCount} active · ${openCount} new`}
            <ConnectionPill connection={connection} lastSyncedAt={lastSyncedAt} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A switch, not a button: the label names what it controls and the
              knob carries the state, so "Sound on" can never read as an
              instruction to turn sound on. */}
          <button
            type="button"
            role="switch"
            aria-checked={soundOn}
            onClick={() => setSoundOn(!soundOn)}
            title={soundOn ? "New orders play a chime" : "Turn on a chime for new orders"}
            className="inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            <span>Chime</span>
            <span
              aria-hidden="true"
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                soundOn ? "bg-accent-700" : "bg-line-300"
              }`}
            >
              <span
                className={`absolute left-0.5 h-4 w-4 rounded-full bg-surface-base shadow-sm transition-transform ${
                  soundOn ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </button>
          <button
            type="button"
            onClick={() => refreshAll()}
            className="rounded-full border border-line-300 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {notificationsAvailable && notificationPermission === "default" && hasArrived && (
        <button
          type="button"
          onClick={() => void requestNotifications()}
          className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 text-left text-sm text-accent-900 transition-colors hover:border-accent-500"
        >
          <span className="font-semibold">Notify me even when you&apos;re on another tab.</span>
          <span className="mt-0.5 block text-xs">
            Your browser will ask for permission — alerts work whether this tab is open or not.
          </span>
        </button>
      )}
      {notificationsAvailable && notificationPermission === "granted" && (
        <p className="text-xs text-ink-500">
          Browser notifications are on — new orders alert you even from another tab.
        </p>
      )}

      {/* Compact pill above the Kanban: hidden card tickets stay one tap
          away. Paid arrivals land on the board through the poll. */}
      {awaitingOrders.length > 0 && (
        <section aria-label={`Awaiting payment (${awaitingOrders.length})`}>
          <button
            type="button"
            onClick={() => setAwaitingOpen((open) => !open)}
            aria-expanded={awaitingOpen}
            className="inline-flex items-center gap-2 rounded-full border border-line-200 bg-surface-base px-3 py-1 text-xs font-semibold text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning-600" />
            {awaitingOrders.length} awaiting payment
            <span aria-hidden="true" className="text-ink-400">
              {awaitingOpen ? "▾" : "▸"}
            </span>
          </button>
          {awaitingOpen && (
            <div className="mt-2 rounded-2xl border border-line-200 bg-surface-base p-3">
              <p className="text-[11px] text-ink-500">
                Cards stay off the board until Stripe confirms — paid tickets appear below.
              </p>
              <ul className="mt-1 divide-y divide-line-100">
                {awaitingOrders.map((order) => {
                  const total = orderTotal(order.lines);
                  const badge = normalizePaymentStatus(order.paymentStatus);
                  return (
                    <li
                      key={order.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm"
                    >
                      <span className="font-bold text-ink-900">#{orderCode(order.id)}</span>
                      <span className="text-ink-700">{formatTableLabel(order.tableLabel)}</span>
                      <span className="text-xs text-ink-500">
                        {formatElapsed(order.createdAt)} ·{" "}
                        {total === null
                          ? "no price"
                          : formatPreviewPrice(total, null, order.currency)}
                      </span>
                      <StatusChip size="sm" tone={paymentStatusTone(badge)}>
                        {paymentStatusLabel(badge)}
                      </StatusChip>
                      <button
                        type="button"
                        disabled={checkingId === order.id}
                        onClick={() => void checkPayment(order)}
                        className="ml-auto rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 disabled:opacity-50"
                      >
                        {checkingId === order.id ? "Checking…" : "Check payment"}
                      </button>
                      {checkNote && checkNote.orderId === order.id && (
                        <span className="basis-full text-xs text-ink-600">{checkNote.text}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}
      {awaitingLoading && awaitingOrders.length === 0 && (
        <p className="text-xs text-ink-500">Checking for card payments…</p>
      )}

      {(error ?? pollError) && (
        <p
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          {error ?? pollError}
        </p>
      )}

      {phase === "loading" && orders.length === 0 ? (
        <OrdersSkeleton />
      ) : orders.length === 0 && !error ? (
        <GuidanceCard
          title="No orders yet"
          steps={[
            "Print your table cards from the Tables tab.",
            "Scan one with a phone and place a real order — it shows up here within seconds.",
          ]}
          action={{ href: "/tables", label: "Go to Tables" }}
        />
      ) : (
        <>
          <KanbanBoard
            orders={orders}
            busyId={busyId}
            onAdvance={(order, target) => void move(order, target)}
            onCancel={(order) => void cancel(order)}
            onCheckPayment={(order) => void checkPayment(order)}
            checkingId={checkingId}
            checkNote={checkNote}
            window={historyWindow}
            onWindowChange={setHistoryWindow}
          />
          {hasMore ? (
            <button
              type="button"
              onClick={() => loadMore()}
              disabled={loadingMore}
              className="mx-auto rounded-full border border-line-300 px-5 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 disabled:opacity-50"
            >
              {loadingMore ? "Loading older orders…" : "Show older orders"}
            </button>
          ) : null}
          {!hasMore && counts !== null && counts.total > orders.length ? (
            <p className="text-center text-xs text-ink-500">
              New orders arrived while paging — press Refresh to reconcile.
            </p>
          ) : null}
        </>
      )}
      {dialog}
    </div>
  );
}

function ConnectionPill({
  connection,
  lastSyncedAt,
}: {
  connection: "idle" | "connecting" | "live" | "reconnecting";
  lastSyncedAt: string | null;
}) {
  const label =
    connection === "live"
      ? `Live · updated ${lastSyncedAt ? formatTime(lastSyncedAt) : "now"}`
      : connection === "reconnecting"
        ? `Reconnecting…${lastSyncedAt ? ` last update ${formatTime(lastSyncedAt)}` : ""}`
        : "Connecting…";
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 px-2.5 py-0.5 text-[11px] font-semibold text-ink-900"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          connection === "live"
            ? "bg-success-700"
            : connection === "reconnecting"
              ? "animate-pulse bg-warning-600"
              : "bg-ink-400"
        }`}
      />
      {label}
    </span>
  );
}

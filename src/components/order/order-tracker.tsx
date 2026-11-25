"use client";

/**
 * Diner order tracker card (v1): the live status under the confirmation.
 *
 * Renders inside `OrderReceived`'s children slot, so no route changes to
 * grow the receipt. Dine-in copy only (Received → Preparing → Served — never
 * "Ready"), a polite live region for changes, and an explicit opt-in copy
 * link for table-mates with honest "anyone with this link" copy.
 */

import { useState } from "react";

import { orderCode, orderItemCountLabel, orderTotal, type Order } from "@/features/orders/schema";
import { formatTableLabel } from "@/features/orders/table-links";

import { formatOrderTotal } from "./order-menu";
import {
  isTerminalStatus,
  trackerCopy,
  useOrderTracker,
} from "@/features/orders/use-order-tracker";

interface OrderTrackerProps {
  orderId: string;
  token: string | null;
  initialOrder: Order;
  restaurantName?: string | null;
}

function stepIndex(status: Order["status"]): number {
  if (status === "new") return 0;
  if (status === "preparing") return 1;
  return 2;
}

export function OrderTracker({ orderId, token, initialOrder, restaurantName }: OrderTrackerProps) {
  const {
    order,
    phase,
    error,
    notificationPermission,
    notificationsAvailable,
    requestNotifications,
    refresh,
  } = useOrderTracker({ orderId, token, initialOrder });
  const [copied, setCopied] = useState(false);
  const [linkShown, setLinkShown] = useState(false);

  const where = formatTableLabel(order.tableLabel);
  const terminal = isTerminalStatus(order.status);
  const activeIndex = order.status === "cancelled" ? -1 : stepIndex(order.status);

  async function copyLink() {
    if (!token) return;
    const url = `${window.location.origin}${window.location.pathname}?track=${encodeURIComponent(token)}`;
    try {
      await window.navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      setLinkShown(true);
    }
  }

  return (
    <div className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-100 p-5 text-left">
      <div aria-live="polite" role="status" className="sr-only">
        {trackerCopy(order.status)}
      </div>

      <p className="text-sm font-semibold text-ink-900" aria-hidden="true">
        {trackerCopy(order.status)}
      </p>
      <p className="mt-1 text-xs text-ink-500">
        {restaurantName ? `${restaurantName} · ${where}` : where} ·{" "}
        {orderItemCountLabel(order.lines)} ·{" "}
        {formatOrderTotal(order.currency, orderTotal(order.lines))} · #{orderCode(order.id)}
      </p>

      {order.status !== "cancelled" ? (
        <ol className="mt-4 flex items-center gap-1" aria-label="Order progress">
          {["Received", "Preparing", "Served"].map((label, index) => {
            const done = index <= activeIndex;
            const current = index === activeIndex && !terminal;
            return (
              <li key={label} className="flex flex-1 items-center gap-1 last:flex-none">
                <span
                  aria-current={current ? "step" : undefined}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    done ? "bg-success-700 text-white" : "bg-surface-sunken text-ink-500"
                  }`}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span className={`text-xs ${done ? "font-semibold text-ink-900" : "text-ink-500"}`}>
                  {label}
                </span>
                {index < 2 && <span aria-hidden="true" className="mx-1 h-px flex-1 bg-line-200" />}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 rounded-xl bg-danger-50 px-3 py-2 text-xs text-danger-800">
          This order was cancelled — ask staff.
        </p>
      )}

      {!terminal && <p className="mt-3 text-xs text-ink-500">Keep this page open for updates.</p>}

      {phase === "error" && error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800"
        >
          {error}{" "}
          <button type="button" onClick={refresh} className="font-semibold underline">
            Try again
          </button>
        </p>
      )}
      {phase === "expired" && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800"
        >
          {error ?? "That order link is no longer valid. Ask staff to check your order."}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {notificationsAvailable && notificationPermission !== "granted" && !terminal && (
          <button
            type="button"
            onClick={() => void requestNotifications()}
            className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900"
          >
            Tell me when it&apos;s served
          </button>
        )}
        {token && !linkShown && (
          <button
            type="button"
            onClick={() => setLinkShown(true)}
            className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900"
          >
            Share this order&apos;s status
          </button>
        )}
      </div>

      {token && linkShown && (
        <div className="mt-3 rounded-xl bg-surface-sunken p-3">
          <p className="text-xs text-ink-600">
            Anyone with this link can see this order. Share it with your table only.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-full bg-accent-700 px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-800"
            >
              {copied ? "Copied" : "Copy order link"}
            </button>
            <button
              type="button"
              onClick={() => setLinkShown(false)}
              className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-700"
            >
              Hide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

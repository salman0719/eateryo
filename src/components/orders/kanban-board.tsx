"use client";

/**
 * Shared Kanban board (prototype B): New / Preparing / Done columns over the
 * same filter model. Both the server board and the local queue render through
 * here so the kitchen sees one layout either way.
 *
 * Filters default to the last 24 hours with a text search and a "hide done"
 * toggle. New owns the first column and never scrolls away inside history.
 */

import { useMemo, useState } from "react";

import {
  filterBoardOrders,
  formatElapsed,
  groupBoardOrders,
  isNewHot,
  type BoardFilter,
} from "@/features/orders/board-filters";
import {
  nextOrderStatus,
  orderCode,
  orderItemCount,
  orderStatusLabel,
  orderTotal,
  type Order,
  type OrderStatus,
} from "@/features/orders/schema";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";
import { OrderLineOptions } from "@/components/order/option-groups";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";

const STATUS_TONES: Record<OrderStatus, StatusTone> = {
  new: "warning",
  preparing: "info",
  served: "success",
  cancelled: "neutral",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function BoardFilterBar({
  filter,
  onChange,
  visible,
  total,
}: {
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
  visible: number;
  total: number;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line-200 bg-surface-base py-2">
      <label className="sr-only" htmlFor="board-window">
        Time window
      </label>
      <select
        id="board-window"
        value={filter.window}
        onChange={(event) =>
          onChange({ ...filter, window: event.target.value as BoardFilter["window"] })
        }
        className="rounded-full border border-line-300 bg-surface-base px-3 py-1.5 text-sm text-ink-700"
      >
        <option value="24h">Last 24 hours</option>
        <option value="all">All time</option>
      </select>
      <label className="sr-only" htmlFor="board-search">
        Filter orders
      </label>
      <input
        id="board-search"
        type="search"
        value={filter.query}
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
        placeholder="Filter: table, dish, #code…"
        className="min-w-44 flex-1 rounded-full border border-line-300 bg-surface-base px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-500 sm:max-w-64 sm:flex-none"
      />
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={filter.hideDone}
          onChange={(event) => onChange({ ...filter, hideDone: event.target.checked })}
          className="size-4 accent-[var(--color-accent-700)]"
        />
        Hide done
      </label>
      <span className="ml-auto text-xs text-ink-500">
        {visible} of {total} · default is 24h, not all-time
      </span>
    </div>
  );
}

function OrderTicket({
  order,
  busy,
  onAdvance,
  onCancel,
  onDelete,
}: {
  order: Order;
  busy: boolean;
  onAdvance: (order: Order, target: OrderStatus) => void;
  onCancel: (order: Order) => void;
  onDelete?: (order: Order) => void;
}) {
  const total = orderTotal(order.lines);
  const next = nextOrderStatus(order.status);
  const canAdvance = next !== order.status;
  const hot = isNewHot(order);
  const itemCount = orderItemCount(order.lines);

  return (
    <article
      aria-busy={busy}
      className={`rounded-xl border bg-surface-base p-3 ${
        order.status === "new" ? "border-warning-300" : "border-line-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-sm font-bold text-ink-900">{formatTableLabel(order.tableLabel)}</p>
        <StatusChip tone={STATUS_TONES[order.status]} size="sm">
          {orderStatusLabel(order.status)}
        </StatusChip>
        <span className="text-[11px] font-medium text-ink-500">
          #{orderCode(order.id)} · {formatTime(order.createdAt)}
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            hot ? "bg-danger-50 text-danger-800" : "bg-surface-100 text-ink-700"
          }`}
          title={`Placed ${formatTime(order.createdAt)}`}
        >
          ⏱ {formatElapsed(order.createdAt)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-500">
        {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
        {total === null ? "no price" : formatPreviewPrice(total, null, order.currency)}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {order.lines.map((line, index) => (
          <li
            key={`${line.menuItemId}-${line.variantName ?? "base"}-${index}`}
            className="flex items-baseline justify-between gap-2 text-xs text-ink-700"
          >
            <span className="min-w-0 truncate">
              <span className="font-semibold text-ink-900">{line.quantity}×</span> {line.name}
              {line.variantName && <span className="ml-1 text-ink-500">{line.variantName}</span>}
              <OrderLineOptions options={line.options} currency={order.currency} />
            </span>
            <span className="shrink-0 tabular-nums text-ink-500">
              {line.unitPrice === null
                ? "no price"
                : formatPreviewPrice(line.unitPrice * line.quantity, null, order.currency)}
            </span>
          </li>
        ))}
      </ul>
      {order.note && (
        <p className="mt-1.5 rounded-lg bg-warning-50 px-2 py-1 text-[11px] text-warning-900">
          ✎ {order.note}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {canAdvance && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdvance(order, next)}
            className="flex-1 rounded-full bg-accent-700 px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:opacity-50"
          >
            {order.status === "new" ? "Start →" : `Serve ✓`}
          </button>
        )}
        {order.status !== "cancelled" && order.status !== "served" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCancel(order)}
            className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(order)}
            className="ml-auto text-[11px] font-medium text-ink-500 underline hover:text-danger-800 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

export function KanbanBoard({
  orders,
  busyId,
  onAdvance,
  onCancel,
  onDelete,
}: {
  orders: Order[];
  busyId: string | null;
  onAdvance: (order: Order, target: OrderStatus) => void;
  onCancel: (order: Order) => void;
  onDelete?: (order: Order) => void;
}) {
  const [filter, setFilter] = useState<BoardFilter>({ window: "24h", query: "", hideDone: false });
  const filtered = useMemo(() => filterBoardOrders(orders, filter), [orders, filter]);
  const grouped = useMemo(() => groupBoardOrders(filtered), [filtered]);

  const columns = [
    { key: "new", title: "🔥 New", orders: grouped.fresh, highlight: true },
    { key: "preparing", title: "🍳 Preparing", orders: grouped.preparing, highlight: false },
    { key: "done", title: "✓ Done", orders: grouped.done, highlight: false },
  ] as const;

  return (
    <div>
      <BoardFilterBar filter={filter} onChange={setFilter} visible={filtered.length} total={orders.length} />
      <div className="mt-3 grid items-start gap-3 md:grid-cols-3">
        {columns.map((column) => (
          <section
            key={column.key}
            aria-label={`${column.title} (${column.orders.length})`}
            className={`flex min-h-44 flex-col gap-2 rounded-2xl p-2.5 ${
              column.highlight
                ? "border border-warning-300 bg-warning-50"
                : "border border-line-200 bg-surface-100"
            }`}
          >
            <h3 className="flex items-center gap-2 px-1 pt-1 text-xs font-bold tracking-wide text-ink-900 uppercase">
              {column.title}
              <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-bold text-surface-base">
                {column.orders.length}
              </span>
            </h3>
            {column.orders.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-300 bg-surface-base px-3 py-4 text-center text-xs text-ink-500">
                {column.key === "new" ? "All caught up 🎉" : "Nothing here."}
              </p>
            ) : (
              column.orders.map((order) => (
                <OrderTicket
                  key={order.id}
                  order={order}
                  busy={busyId === order.id}
                  onAdvance={onAdvance}
                  onCancel={onCancel}
                  onDelete={onDelete}
                />
              ))
            )}
          </section>
        ))}
      </div>
      {filtered.length === 0 && orders.length > 0 && (
        <p className="mt-3 text-center text-sm text-ink-500">
          No orders match this filter — try All time or clear the search.
        </p>
      )}
    </div>
  );
}


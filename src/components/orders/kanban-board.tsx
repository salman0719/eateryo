"use client";

/**
 * Shared Kanban board (prototype B): New / Preparing / Done columns over the
 * same filter model. Both the server board and the local queue render through
 * here so the kitchen sees one layout either way.
 *
 * Filters default to the last 24 hours with a text search and a "hide done"
 * toggle. New owns the first column and never scrolls away inside history.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import {
  distinctBoardTables,
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

// Ghost lifecycle: fully laid out, then a height dissolve so removal doesn't pop.
const GHOST_VISIBLE_MS = 8500;
const GHOST_COLLAPSE_MS = 600;

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
  tables,
  onChange,
}: {
  filter: BoardFilter;
  tables: string[];
  onChange: (next: BoardFilter) => void;
}) {
  const hiddenCount = filter.excludedTables?.length ?? 0;
  const [tablesOpen, setTablesOpen] = useState(false);
  const tablesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tablesOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (tablesRef.current && !tablesRef.current.contains(event.target as Node)) {
        setTablesOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTablesOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tablesOpen]);
  const toggleTable = (table: string) => {
    const current = filter.excludedTables ?? [];
    onChange({
      ...filter,
      excludedTables: current.includes(table)
        ? current.filter((entry) => entry !== table)
        : [...current, table],
    });
  };
  const showOnlyTable = (table: string) => {
    onChange({ ...filter, excludedTables: tables.filter((entry) => entry !== table) });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
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
        placeholder="Filter: dish, #code…"
        className="min-w-44 flex-1 rounded-full border border-line-300 bg-surface-base px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-500 sm:max-w-64 sm:flex-none"
      />
      <div ref={tablesRef} className="relative">
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={tablesOpen}
          onClick={() => setTablesOpen((open) => !open)}
          className="cursor-pointer rounded-full border border-line-300 bg-surface-base px-3 py-1.5 text-sm text-ink-700"
        >
          Tables{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
        </button>
        {tablesOpen && (
          <div className="absolute z-20 mt-1 max-h-64 w-52 overflow-auto rounded-xl border border-line-200 bg-surface-base p-1.5 shadow-lg">
            {tables.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-ink-500">No tables yet.</p>
            ) : (
              tables.map((table) => {
                const hidden = filter.excludedTables?.includes(table) ?? false;
                return (
                  <div
                    key={table}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-100"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-ink-900">
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => toggleTable(table)}
                        className="size-4 accent-[var(--color-accent-700)]"
                      />
                      {formatTableLabel(table)}
                    </label>
                    <button
                      type="button"
                      title={`Show only ${formatTableLabel(table)}`}
                      onClick={() => {
                        showOnlyTable(table);
                        setTablesOpen(false);
                      }}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-500 hover:bg-surface-200 hover:text-ink-900"
                    >
                      Only
                    </button>
                  </div>
                );
              })
            )}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  onChange({ ...filter, excludedTables: [] });
                  setTablesOpen(false);
                }}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-center text-sm font-medium text-ink-700 hover:bg-surface-100"
              >
                Show all tables
              </button>
            )}
          </div>
        )}
      </div>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={filter.hideDone}
          onChange={(event) => onChange({ ...filter, hideDone: event.target.checked })}
          className="size-4 accent-[var(--color-accent-700)]"
        />
        Hide done
      </label>
    </div>
  );
}

function OrderTicket({
  order,
  busy,
  highlighted,
  onAdvance,
  onCancel,
  onDelete,
}: {
  order: Order;
  busy: boolean;
  highlighted?: boolean;
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
        highlighted
          ? `order-just-moved ${order.status === "new" ? "border-warning-300" : "border-line-200"}`
          : order.status === "new"
            ? "border-warning-300"
            : "border-line-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-sm font-bold text-ink-900">{formatTableLabel(order.tableLabel)}</p>
        <StatusChip tone={STATUS_TONES[order.status]} size="sm">
          {orderStatusLabel(order.status)}
        </StatusChip>
        {highlighted && (
          <span className="rounded-full bg-accent-700 px-2 py-0.5 text-[11px] font-bold text-on-accent">
            Just moved
          </span>
        )}
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
  window,
  onWindowChange,
}: {
  orders: Order[];
  busyId: string | null;
  onAdvance: (order: Order, target: OrderStatus) => void;
  onCancel: (order: Order) => void;
  onDelete?: (order: Order) => void;
  /**
   * Controlled history window (the server board owns it so a change
   * refetches from SQL). Omitted, the board owns its own window state —
   * the local queue's mode.
   */
  window?: BoardFilter["window"];
  onWindowChange?: (window: BoardFilter["window"]) => void;
}) {
  const [localFilter, setLocalFilter] = useState<BoardFilter>({
    window: "24h",
    query: "",
    hideDone: false,
    excludedTables: [],
  });
  // Controlled window, local search: the server board owns `window` so a
  // change refetches from SQL; the local queue owns everything.
  const filter = useMemo<BoardFilter>(
    () => (window === undefined ? localFilter : { ...localFilter, window }),
    [window, localFilter]
  );
  const setFilter = (next: BoardFilter) => {
    if (window !== undefined && next.window !== window) onWindowChange?.(next.window);
    setLocalFilter(next);
  };
  const tables = useMemo(() => distinctBoardTables(orders), [orders]);
  const filtered = useMemo(() => filterBoardOrders(orders, filter), [orders, filter]);
  const grouped = useMemo(() => groupBoardOrders(filtered), [filtered]);
  // Experiment: keep the ticket the user just moved visible. The status
  // flip jumps columns, so we glow its border for 10s. The glow runs once
  // and dissolves back to transparent, so removing the class at timeout
  // is invisible.
  // Ghost: leave a placeholder in the source column so the eye sees
  // where the ticket went.
  const [justMoved, setJustMoved] = useState<{
    id: string;
    from: "new" | "preparing" | "done";
    index: number;
  } | null>(null);
  // Two-phase ghost exit: fully laid out for GHOST_VISIBLE_MS, then a
  // height dissolve for GHOST_COLLAPSE_MS so removal doesn't pop.
  const [ghostLeaving, setGhostLeaving] = useState(false);
  const justMovedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flagJustMoved = (orderId: string, fromStatus: OrderStatus, fromIndex: number) => {
    const from = fromStatus === "new" ? "new" : fromStatus === "preparing" ? "preparing" : "done";
    justMovedTimers.current.forEach(clearTimeout);
    justMovedTimers.current = [];
    setGhostLeaving(false);
    setJustMoved({ id: orderId, from, index: fromIndex < 0 ? 0 : fromIndex });
    justMovedTimers.current.push(
      setTimeout(() => setGhostLeaving(true), GHOST_VISIBLE_MS),
      setTimeout(
        () => {
          setJustMoved(null);
          setGhostLeaving(false);
        },
        GHOST_VISIBLE_MS + GHOST_COLLAPSE_MS + 50
      )
    );
  };
  useEffect(
    () => () => {
      justMovedTimers.current.forEach(clearTimeout);
    },
    []
  );
  const sourceIndexFor = (order: Order) => {
    const source =
      order.status === "new"
        ? grouped.fresh
        : order.status === "preparing"
          ? grouped.preparing
          : grouped.done;
    return source.findIndex((entry) => entry.id === order.id);
  };
  const handleAdvance = (order: Order, target: OrderStatus) => {
    const fromIndex = sourceIndexFor(order);
    onAdvance(order, target);
    flagJustMoved(order.id, order.status, fromIndex);
  };
  const handleCancel = (order: Order) => {
    const fromIndex = sourceIndexFor(order);
    onCancel(order);
    flagJustMoved(order.id, order.status, fromIndex);
  };

  const columns = [
    { key: "new", title: "🔥 New", orders: grouped.fresh, highlight: true },
    { key: "preparing", title: "🍳 Preparing", orders: grouped.preparing, highlight: false },
    { key: "done", title: "✓ Done", orders: grouped.done, highlight: false },
  ] as const;

  return (
    <div>
      <style>{`@keyframes order-just-moved-glow {
        0% { box-shadow: 0 0 0 0 transparent; }
        6% { box-shadow: 0 0 0 2px var(--color-accent-500), 0 0 14px color-mix(in srgb, var(--color-accent-500) 55%, transparent); }
        18% { box-shadow: 0 0 0 4px var(--color-accent-500), 0 0 22px color-mix(in srgb, var(--color-accent-500) 80%, transparent); }
        30% { box-shadow: 0 0 0 2px var(--color-accent-500), 0 0 14px color-mix(in srgb, var(--color-accent-500) 55%, transparent); }
        42% { box-shadow: 0 0 0 4px var(--color-accent-500), 0 0 22px color-mix(in srgb, var(--color-accent-500) 80%, transparent); }
        54% { box-shadow: 0 0 0 2px var(--color-accent-500), 0 0 14px color-mix(in srgb, var(--color-accent-500) 55%, transparent); }
        66% { box-shadow: 0 0 0 4px var(--color-accent-500), 0 0 22px color-mix(in srgb, var(--color-accent-500) 80%, transparent); }
        78% { box-shadow: 0 0 0 2px var(--color-accent-500), 0 0 14px color-mix(in srgb, var(--color-accent-500) 55%, transparent); }
        90% { box-shadow: 0 0 0 4px var(--color-accent-500), 0 0 22px color-mix(in srgb, var(--color-accent-500) 80%, transparent); }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
      .order-just-moved { animation: order-just-moved-glow 10s ease-in-out 1 forwards; }
      @media (prefers-reduced-motion: reduce) { .order-just-moved { animation: none; } }`}</style>
      <BoardFilterBar filter={filter} tables={tables} onChange={setFilter} />
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
            <h3
              className={`sticky top-0 z-10 -mx-2.5 -mt-2.5 flex items-center gap-2 rounded-t-2xl px-3.5 pt-3 pb-2 text-xs font-bold tracking-wide text-ink-900 uppercase ${
                column.highlight ? "bg-warning-50" : "bg-surface-100"
              }`}
            >
              {column.title}
              <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-bold text-surface-base">
                {column.orders.length}
              </span>
            </h3>
            {(() => {
              const ghostOrder =
                justMoved && justMoved.from === column.key
                  ? (orders.find((entry) => entry.id === justMoved.id) ?? null)
                  : null;
              const showGhost =
                !!ghostOrder && !column.orders.some((entry) => entry.id === ghostOrder.id);
              // Sustain the ticket's index: insert where it was, clamped to
              // the shrunken list, instead of appending at the bottom.
              const insertAt = showGhost
                ? Math.min(Math.max(justMoved?.index ?? 0, 0), column.orders.length)
                : -1;
              if (column.orders.length === 0 && !showGhost) {
                return (
                  <p className="rounded-xl border border-dashed border-line-300 bg-surface-base px-3 py-4 text-center text-xs text-ink-500">
                    {column.key === "new" ? "All caught up 🎉" : "Nothing here."}
                  </p>
                );
              }
              const ghostNode: ReactElement | null =
                showGhost && ghostOrder ? (
                  <div
                    key={`ghost-${ghostOrder.id}`}
                    aria-hidden="true"
                    // Height dissolve: 1fr -> 0fr collapses the exact ticket
                    // height; negative margin cancels the column gap so the
                    // final removal doesn't jump. Opacity fades alongside.
                    className="grid transition-all ease-in-out motion-reduce:transition-none"
                    style={{
                      gridTemplateRows: ghostLeaving ? "0fr" : "1fr",
                      opacity: ghostLeaving ? 0 : 1,
                      marginTop: ghostLeaving ? -8 : 0,
                      transitionDuration: `${GHOST_COLLAPSE_MS}ms`,
                    }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      {/* Exact ticket layout, ghosted: same article, buttons
                        kept disabled so the height matches pixel-for-pixel.
                        Visual-only filters + dashed border; overlay pill is
                        absolute so it never changes the layout. */}
                      <div className="pointer-events-none relative select-none opacity-60 saturate-50 grayscale [&_article]:border-dashed [&_article]:bg-surface-base/60 [&_article]:shadow-none">
                        <div inert={true}>
                          <OrderTicket
                            order={ghostOrder}
                            busy={true}
                            onAdvance={() => {}}
                            onCancel={() => {}}
                          />
                        </div>
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <span className="rounded-full bg-ink-900/75 px-3 py-1 text-[11px] font-bold text-surface-base shadow">
                            → Moved to {orderStatusLabel(ghostOrder.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null;
              const nodes: ReactElement[] = [];
              column.orders.forEach((order, orderIndex) => {
                if (showGhost && orderIndex === insertAt && ghostNode) nodes.push(ghostNode);
                nodes.push(
                  <OrderTicket
                    key={order.id}
                    order={order}
                    busy={busyId === order.id}
                    highlighted={justMoved?.id === order.id}
                    onAdvance={handleAdvance}
                    onCancel={handleCancel}
                    onDelete={onDelete}
                  />
                );
              });
              if (showGhost && insertAt >= column.orders.length && ghostNode) nodes.push(ghostNode);
              return nodes;
            })()}
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

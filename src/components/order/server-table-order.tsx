"use client";

/**
 * Table ordering from a public link (Step 10):
 * `/r/<restaurant>/m/<menu>/order?table=<label>`.
 *
 * The menu arrives from the server (the published snapshot), so this works on
 * a phone that has never opened the app. The diner sends only item ids,
 * variants, and quantities; the kitchen's server copies names and prices and
 * recomputes the total, so nothing here is trusted as a price.
 *
 * Honest failure states: an unpublishable menu 404s before this renders, a
 * sold-out item stays disabled, and a rejected or rate-limited order says so
 * plainly instead of pretending it was sent.
 */

import { useRef, useState } from "react";

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { placeOrder } from "@/features/orders/client";
import {
  priceWithOptions,
  selectionsKey,
  validateOptionSelections,
  withResolvedDeltas,
  type OptionSelection,
} from "@/features/menu/option-groups";
import {
  addLine,
  orderCode,
  orderTotal,
  setLineQuantity,
  type Order,
  type OrderLine,
} from "@/features/orders/schema";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "@/features/orders/table-links";

import { OrderCartPanel, useWideLayout } from "./order-cart";
import { OrderMenuSection, OrderShell, StickyCartBar, formatOrderTotal } from "./order-menu";
import { OrderSheet } from "./order-sheet";

interface ServerTableOrderProps {
  /** The café's public slug — the order is resolved inside it. */
  restaurantSlug: string;
  /** The menu's own address segment under that café. */
  slug: string;
  doc: MenuDocument;
  tableLabel: string;
  restaurantName: string;
}

export function ServerTableOrder({
  restaurantSlug,
  slug,
  doc,
  tableLabel,
  restaurantName,
}: ServerTableOrderProps) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [note, setNote] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const viewOrderButton = useRef<HTMLButtonElement | null>(null);
  /** Wide screens keep the order in its own column; phones raise the sheet. */
  const wide = useWideLayout();

  const total = orderTotal(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const frame = "rounded-2xl border border-line-200 bg-surface-base";

  function chosenVariantName(item: MenuItem): string | null {
    if (item.variants.length === 0) return null;
    const chosen = variantChoice[item.id];
    if (chosen && item.variants.some((variant) => variant.name === chosen)) return chosen;
    return item.variants[0]?.name ?? null;
  }

  function addItem(item: MenuItem, selections: OptionSelection[]) {
    const problem = validateOptionSelections(item, selections);
    if (problem) {
      setError(problem);
      return;
    }
    const variantName = chosenVariantName(item);
    const variant = variantName ? item.variants.find((v) => v.name === variantName) : null;
    const base = variant ? variant.price : item.price;
    const key = selectionsKey(selections);
    setLines((current) =>
      addLine(current, {
        menuItemId: item.id,
        name: item.name,
        variantName,
        options: selections,
        unitPrice: priceWithOptions(base, item, selections),
      }).map((line) =>
        line.menuItemId === item.id &&
        (line.variantName ?? null) === variantName &&
        selectionsKey(line.options) === key
          ? { ...line, options: withResolvedDeltas(item, line.options) }
          : line
      )
    );
    setError(null);
  }

  /** Quantity changes go through here so emptying the order closes the sheet. */
  function setQuantity(index: number, quantity: number) {
    const next = setLineQuantity(lines, index, quantity);
    setLines(next);
    if (next.length === 0) setSheetOpen(false);
  }

  async function sendOrder() {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await placeOrder({
        restaurantSlug,
        slug,
        tableLabel,
        note: note.trim() ? note : null,
        lines: lines.map((line) => ({
          menuItemId: line.menuItemId,
          variantName: line.variantName,
          options: line.options.map((option) => ({
            groupName: option.groupName,
            choiceName: option.choiceName,
          })),
          quantity: line.quantity,
        })),
        website: honeypot,
      });
      setPlaced(order);
      setLines([]);
      setNote("");
      setSheetOpen(false);
    } catch (submitError: unknown) {
      setError(
        submitError instanceof SyncError
          ? submitError.code === "not_found"
            ? "This menu is no longer published. Ask staff for the current link."
            : submitError.message
          : "The order could not be sent. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (placed) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-sm font-semibold tracking-wider text-success-800 uppercase">
            Order received
          </p>
          <p className="mt-3 text-2xl font-bold text-ink-900">
            #{orderCode(placed.id)} · {formatTableLabel(placed.tableLabel)}
          </p>
          <p className="mt-2 text-sm text-ink-600">
            {placed.lines.length} {placed.lines.length === 1 ? "line" : "lines"} ·{" "}
            {formatOrderTotal(placed.currency, orderTotal(placed.lines))}
          </p>
          <p className="mx-auto mt-4 max-w-md text-xs leading-5 text-ink-500">
            The kitchen sees this on their board right away. The total is confirmed when your order
            is prepared.
          </p>
          <button
            type="button"
            onClick={() => setPlaced(null)}
            className="mt-5 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800"
          >
            Order something else
          </button>
        </div>
      </OrderShell>
    );
  }

  /**
   * What sits under the cart's total. One node for both cart homes: the sheet
   * on phones and the sticky column on wide screens show the same total, the
   * same warning about an unpriced line, the same server error, and the same
   * button.
   */
  const orderFooter = (
    <>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-ink-600">Total</p>
        <p className="text-lg font-bold tabular-nums text-ink-900">
          {formatOrderTotal(doc.currency, total)}
        </p>
      </div>
      {lines.length > 0 && total === null && (
        <p className="mt-1 text-xs text-warning-800">
          Some items have no price on the menu, so no total is shown. Staff confirm the price.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-50 px-3 py-2 text-xs text-danger-800">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={submitting || lines.length === 0}
        onClick={() => void sendOrder()}
        className="mt-3 w-full rounded-full bg-accent-700 px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Sending…" : "Send order to the kitchen"}
      </button>
    </>
  );

  return (
    <OrderShell tableLabel={tableLabel}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className={`${frame} p-5`}>
            <p className="text-sm font-semibold tracking-wider text-warning-800 uppercase">
              {restaurantName} · {formatTableLabel(tableLabel)}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-ink-900">
              {doc.title.trim() || "Untitled menu"}
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Tap a dish to add it. No account or app needed.
            </p>
          </div>

          {doc.categories.map((category) => (
            <OrderMenuSection
              key={category.id}
              category={category}
              currency={doc.currency}
              variantChoice={variantChoice}
              onVariantChange={(itemId, name) =>
                setVariantChoice((current) => ({ ...current, [itemId]: name }))
              }
              onAdd={addItem}
            />
          ))}
        </div>

        {wide && (
          <OrderCartPanel
            lines={lines}
            currency={doc.currency}
            subtitle={`${restaurantName} · ${formatTableLabel(tableLabel)}`}
            onQuantityChange={setQuantity}
            note={note}
            onNoteChange={setNote}
            noteId="order-note"
            footer={orderFooter}
          />
        )}
      </div>

      {/*
        Honeypot: visually hidden, unreachable by keyboard, and ignored by
        real people. Only a script fills it, and the server refuses then.
      */}
      <label aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        Website
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </label>

      {!wide && (
        <StickyCartBar
          itemCount={itemCount}
          total={total}
          currency={doc.currency}
          onViewOrder={() => setSheetOpen(true)}
          buttonRef={viewOrderButton}
        />
      )}

      {!wide && sheetOpen && lines.length > 0 && (
        <OrderSheet
          lines={lines}
          currency={doc.currency}
          subtitle={`${restaurantName} · ${formatTableLabel(tableLabel)}`}
          onQuantityChange={setQuantity}
          note={note}
          onNoteChange={setNote}
          noteId="order-note"
          onClose={() => setSheetOpen(false)}
          returnFocusTo={viewOrderButton}
          footer={orderFooter}
        />
      )}
    </OrderShell>
  );
}

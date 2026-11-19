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

import { useEffect, useMemo, useRef, useState } from "react";

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { fetchTrackedOrder, placeOrderWithTracking } from "@/features/orders/client";
import { saveTracker } from "@/features/orders/use-order-tracker";
import {
  priceWithOptions,
  selectionsKey,
  validateOptionSelections,
  withResolvedDeltas,
  type OptionSelection,
} from "@/features/menu/option-groups";
import {
  addLine,
  orderTotal,
  setLineQuantity,
  type Order,
  type OrderLine,
} from "@/features/orders/schema";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "@/features/orders/table-links";

import { OrderCartPanel, useWideLayout } from "./order-cart";
import {
  CategoryRail,
  DinerCoverHeader,
  OrderMenuSection,
  OrderShell,
  OrderSkeleton,
  StickyCartBar,
  formatOrderTotal,
  useScrollSpyCategory,
} from "./order-menu";
import { OrderReceived } from "./order-received";
import { OrderSheet } from "./order-sheet";
import { OrderTracker } from "./order-tracker";

interface ServerTableOrderProps {
  /** The café's public slug — the order is resolved inside it. */
  restaurantSlug: string;
  /** The menu's own address segment under that café. */
  slug: string;
  doc: MenuDocument;
  tableLabel: string;
  restaurantName: string;
  /**
   * The reloadable order token from `?track=`, read server-side so the
   * first paint already knows a resume is coming. While it resolves the
   * page shows a neutral loading state — never the menu, which would
   * flash and vanish once the confirmation arrives.
   */
  resumeToken: string | null;
}

export function ServerTableOrder({
  restaurantSlug,
  slug,
  doc,
  tableLabel,
  restaurantName,
  resumeToken,
}: ServerTableOrderProps) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [note, setNote] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [tracking, setTracking] = useState<{ token: string; expiresAt: string } | null>(null);
  const [resolving, setResolving] = useState(resumeToken !== null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const viewOrderButton = useRef<HTMLButtonElement | null>(null);
  /** Wide screens keep the order in its own column; phones raise the sheet. */
  const wide = useWideLayout();

  const total = orderTotal(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  /** Category rail targets: one anchor per section for the sticky pills. */
  const railCategories = useMemo(
    () =>
      doc.categories.map((category) => ({
        id: `category-${category.id}`,
        label: category.name,
      })),
    [doc.categories]
  );
  const activeCategory = useScrollSpyCategory(railCategories.map((entry) => entry.id));

  function jumpToCategory(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

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

  // Resume from a reloadable link (`?track=`): the token is the only handle
  // this browser has after a reload, so fetch once and show the tracker.
  // The token arrives as a prop (read server-side), so the first paint is
  // already the loading state — the menu never flashes underneath.
  useEffect(() => {
    if (!resumeToken) return;
    let cancelled = false;
    const resumed = resumeToken;
    void (async () => {
      try {
        const result = await fetchTrackedOrder(resumed);
        if (cancelled) return;
        setPlaced(result.order);
        setTracking({ token: resumed, expiresAt: result.serverTime });
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

  async function sendOrder() {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const placedOrder = await placeOrderWithTracking({
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
      setPlaced(placedOrder.order);
      setTracking(placedOrder.tracking);
      if (placedOrder.tracking) {
        saveTracker({
          orderId: placedOrder.order.id,
          token: placedOrder.tracking.token,
          expiresAt: placedOrder.tracking.expiresAt,
          placedAt: new Date().toISOString(),
        });
        const url = new URL(window.location.href);
        url.searchParams.set("track", placedOrder.tracking.token);
        window.history.replaceState(null, "", url.toString());
      }
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
        <OrderReceived
          order={placed}
          restaurantName={restaurantName}
          footnote="The kitchen sees this on their board right away. The total is confirmed when your order is prepared."
          onOrderAgain={() => {
            setPlaced(null);
            setTracking(null);
            const url = new URL(window.location.href);
            url.searchParams.delete("track");
            window.history.replaceState(null, "", url.toString());
          }}
        >
          <OrderTracker
            orderId={placed.id}
            token={tracking?.token ?? null}
            initialOrder={placed}
            restaurantName={restaurantName}
          />
        </OrderReceived>
      </OrderShell>
    );
  }

  if (resumeError) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className="rounded-2xl border border-line-200 bg-surface-base p-8 text-center">
          <p className="text-lg font-semibold text-ink-900">This order link is no longer valid</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">{resumeError}</p>
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
          <DinerCoverHeader
            restaurantName={restaurantName}
            subline={doc.title.trim() || undefined}
          />

          <CategoryRail
            categories={railCategories}
            activeId={activeCategory}
            onSelect={jumpToCategory}
          />

          {doc.categories.map((category, index) => (
            <div key={category.id} id={railCategories[index]?.id} className="scroll-mt-20">
              <OrderMenuSection
                category={category}
                currency={doc.currency}
                variantChoice={variantChoice}
                onVariantChange={(itemId, name) =>
                  setVariantChoice((current) => ({ ...current, [itemId]: name }))
                }
                onAdd={addItem}
              />
            </div>
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

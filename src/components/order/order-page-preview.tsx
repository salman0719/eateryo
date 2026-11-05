"use client";

/**
 * The diner's order page, rendered from a draft menu so an owner can try it
 * before anything is live.
 *
 * It is the real thing wherever it can be: `OrderShell`, the same
 * `OrderMenuSection` rows, the same labels, working size selection, dish
 * search, and the same "Send order to the kitchen" button. The one difference
 * is deliberate — the button never calls the API. There is no import of the
 * order client here, so a preview cannot place an order even by accident; a
 * diner's real order needs a published menu and a scanned table card.
 *
 * The page is mobile-shaped because that is how diners use it — and it stays
 * that way at every viewport width, since the frame is a phone: one column,
 * content edge to edge, and the order in the shared `OrderSheet` that rises
 * from the bottom of the phone screen when "View order" is pressed. A real
 * diner on a wide screen gets the sticky order column instead; a preview
 * inside a 340px frame never should.
 *
 * The table label is a constant ("1") because a draft has no table yet: the
 * preview shows where the table appears on a real card.
 */

import { useEffect, useRef, useState } from "react";

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { searchMenu } from "@/features/menu/search";
import { addLine, orderTotal, setLineQuantity, type OrderLine } from "@/features/orders/schema";
import { formatTableLabel } from "@/features/orders/table-links";

import { OrderMenuSection, OrderShell, StickyCartBar, formatOrderTotal } from "./order-menu";
import { OrderSheet } from "./order-sheet";

/** A draft has no table; the preview shows the one a real card would fill in. */
const PREVIEW_TABLE_LABEL = "1";
/** A toast that clears itself so it never becomes permanent clutter. */
const NOTICE_MS = 8000;

export function OrderPagePreview({
  doc,
  restaurantName,
  draftAheadOfLive = false,
}: {
  doc: MenuDocument;
  /** The café's name when the caller knows it; nothing is invented if not. */
  restaurantName?: string | null;
  /** The draft differs from the published snapshot diners are served today. */
  draftAheadOfLive?: boolean;
}) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewOrderButton = useRef<HTMLButtonElement | null>(null);

  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = orderTotal(lines);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  const frame = "rounded-2xl border border-line-200 bg-surface-base";
  const search = searchMenu(doc, query);
  const searching = query.trim().length > 0;
  const tableName = `${restaurantName?.trim() || "Your café"} · ${formatTableLabel(
    PREVIEW_TABLE_LABEL
  )}`;

  function chosenVariantName(item: MenuItem): string | null {
    if (item.variants.length === 0) return null;
    const chosen = variantChoice[item.id];
    if (chosen && item.variants.some((variant) => variant.name === chosen)) return chosen;
    return item.variants[0]?.name ?? null;
  }

  /** Quantity changes go through here so emptying the order closes the sheet. */
  function setQuantity(index: number, quantity: number) {
    const next = setLineQuantity(lines, index, quantity);
    setLines(next);
    if (next.length === 0) setSheetOpen(false);
  }

  function addItem(item: MenuItem) {
    const variantName = chosenVariantName(item);
    const variant = variantName ? item.variants.find((v) => v.name === variantName) : null;
    setLines((current) =>
      addLine(current, {
        menuItemId: item.id,
        name: item.name,
        variantName,
        unitPrice: variant ? variant.price : item.price,
      })
    );
    setNotice(null);
  }

  /** The button is real, the order is not: say so instead of pretending. */
  function sendToKitchen() {
    if (lines.length === 0) return;
    setNotice(
      "Preview only — this order was not sent to the kitchen. Publish the menu and scan a table card to place a real one."
    );
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }

  return (
    <OrderShell tableLabel={PREVIEW_TABLE_LABEL}>
      <div className="rounded-2xl border border-warning-300 bg-warning-50 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-warning-900 uppercase">
          Preview · nothing is sent
        </p>
        <p className="mt-1 text-sm leading-6 text-warning-900">
          This is the page a table card opens. Try it — nothing reaches the kitchen.
        </p>
        {draftAheadOfLive && (
          <p className="mt-1 text-xs leading-5 font-semibold text-warning-900">
            You are previewing your draft — diners still see the last published version until you
            press “Publish changes”.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className={`${frame} p-5`}>
          <p className="text-sm font-semibold tracking-wider text-warning-800 uppercase">
            {tableName}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-ink-900">
            {doc.title.trim() || "Untitled menu"}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            Here&apos;s what&apos;s on — tap a dish to add it.
          </p>
        </div>

        <nav aria-label="Search the menu" className={`${frame} p-3`}>
          <label className="block">
            <span className="sr-only">Search dishes</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search dishes…"
              className="w-full rounded-xl border border-line-300 px-3 py-2 text-sm focus:border-accent-700 focus:outline-none"
            />
          </label>
          {searching && (
            <p className="mt-2 text-xs text-ink-500" role="status">
              {search.matchCount === 0
                ? `No dishes match “${query.trim()}”.`
                : `${search.matchCount} ${search.matchCount === 1 ? "dish" : "dishes"} match “${query.trim()}”.`}
            </p>
          )}
        </nav>

        {doc.categories.length === 0 ? (
          <div className={`${frame} p-8 text-center`}>
            <p className="text-lg font-semibold text-ink-900">Nothing on the menu yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
              Add a category and items in the editor and they appear here.
            </p>
          </div>
        ) : searching && search.matchCount === 0 ? (
          <div className={`${frame} p-8 text-center`}>
            <p className="text-lg font-semibold text-ink-900">No dishes match</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
              Nothing on this menu matches “{query.trim()}”. Try a shorter search, or clear it to
              browse the whole menu.
            </p>
          </div>
        ) : (
          search.categories.map((match) => (
            <OrderMenuSection
              key={match.category.id}
              category={{ ...match.category, items: match.items }}
              currency={doc.currency}
              variantChoice={variantChoice}
              onVariantChange={(itemId, name) =>
                setVariantChoice((current) => ({ ...current, [itemId]: name }))
              }
              onAdd={addItem}
              itemCount={(item, variantName) =>
                lines.find(
                  (line) =>
                    line.menuItemId === item.id &&
                    (line.variantName ?? null) === (variantName ?? null)
                )?.quantity ?? 0
              }
            />
          ))
        )}
      </div>

      <p className="text-center text-xs leading-5 text-ink-500">
        A scanned table card fills in the real table number, and those diners can order. Missing
        prices show as an em dash — we never invent one.
      </p>

      <StickyCartBar
        contained
        itemCount={itemCount}
        total={total}
        currency={doc.currency}
        onViewOrder={() => setSheetOpen(true)}
        buttonRef={viewOrderButton}
      />

      {sheetOpen && lines.length > 0 && (
        <OrderSheet
          lines={lines}
          currency={doc.currency}
          subtitle={tableName}
          onQuantityChange={setQuantity}
          note={note}
          onNoteChange={setNote}
          noteId="preview-order-note"
          onClose={() => setSheetOpen(false)}
          returnFocusTo={viewOrderButton}
          footer={
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-ink-600">Total</p>
                <p className="text-lg font-bold tabular-nums text-ink-900">
                  {formatOrderTotal(doc.currency, total)}
                </p>
              </div>
              {total === null && (
                <p className="mt-1 text-xs text-warning-800">
                  Some items have no price on the menu, so no total is shown. Staff confirm the
                  price.
                </p>
              )}

              {notice && (
                <div
                  role="status"
                  className="mt-3 flex items-start gap-2 rounded-xl border border-warning-300 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-900"
                >
                  <span className="min-w-0 flex-1">{notice}</span>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    aria-label="Dismiss preview notice"
                    className="shrink-0 font-semibold text-warning-900 hover:text-accent-800"
                  >
                    ×
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={sendToKitchen}
                className="mt-3 w-full rounded-full bg-accent-700 px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800"
              >
                Send order to the kitchen
              </button>
            </>
          }
        />
      )}
    </OrderShell>
  );
}

/**
 * Shared diner-facing pieces of the table ordering screen: the page frame,
 * the add-to-order menu list, and total formatting. Used by both the local
 * (`/order`, IndexedDB) and server (`/r/<restaurant>/m/<menu>/order`,
 * published snapshot) flows so a diner sees the same menu whichever path
 * the café uses.
 *
 * Deliberately free of editing chrome and of any storage import: the server
 * page must not pull IndexedDB code into its bundle just to render a menu.
 */

"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { MenuCategory, MenuItem } from "@/features/menu/schema";
import { dedupeDietaryLabels } from "@/features/menu/dietary-labels";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";

import { ClampedDescription } from "./clamped-description";
import { MenuItemPhoto } from "./menu-item-photo";

/**
 * Loading placeholder for the diner-facing order surfaces: a menu card in
 * the shape the loaded content lands in, so a slow table connection shows
 * the page's outline instead of one centered line. `label` announces the
 * wait to assistive tech; the blocks themselves are decorative.
 */
export function OrderSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="rounded-2xl border border-stone-200 bg-white p-6"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <div className="mt-6 flex flex-col gap-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderShell({
  tableLabel,
  children,
}: {
  tableLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-700 text-base font-bold text-white"
          >
            E
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-ink-900">Eateryo</p>
            <p className="text-xs text-ink-500">Order from your table</p>
          </div>
        </div>
        {tableLabel && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            {formatTableLabel(tableLabel)}
          </span>
        )}
      </header>
      {children}
    </div>
  );
}

export function OrderMenuSection({
  category,
  currency,
  variantChoice,
  onVariantChange,
  onAdd,
  itemCount,
}: {
  category: MenuCategory;
  currency: string | null;
  variantChoice: Record<string, string>;
  onVariantChange: (itemId: string, name: string) => void;
  onAdd: (item: MenuItem) => void;
  /** Quantity of this exact item + variant already in the cart (0 when absent). */
  itemCount?: (item: MenuItem, variantName: string | null) => number;
}) {
  // Per-item confirmation: pops on every tap, gone ~2s later. A fresh tap
  // dismisses the visible pop instantly and replays it, so rapid taps
  // never stack or linger. Removal is timer-driven (animation end is
  // unreliable when the node remounts mid-flight).
  const [flash, setFlash] = useState<Record<string, number>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashSeq = useRef(0);
  useEffect(
    () => () => {
      for (const timer of Object.values(flashTimers.current)) clearTimeout(timer);
    },
    []
  );
  function hideFlash(itemId: string) {
    setFlash((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }
  function bumpFlash(itemId: string) {
    // Drop the visible pop first so the replay starts from a clean mount.
    hideFlash(itemId);
    flashSeq.current += 1;
    const seq = flashSeq.current;
    requestAnimationFrame(() => {
      const pending = flashTimers.current[itemId];
      if (pending !== undefined) clearTimeout(pending);
      setFlash((current) => ({ ...current, [itemId]: seq }));
      flashTimers.current[itemId] = setTimeout(() => {
        delete flashTimers.current[itemId];
        hideFlash(itemId);
      }, 2000);
    });
  }
  return (
    <section
      aria-label={category.name}
      className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
    >
      <h2 className="border-b border-stone-100 bg-stone-50 px-5 py-2.5 text-sm font-bold tracking-wide text-ink-800 uppercase">
        {category.name}
      </h2>
      <ul className="divide-y divide-stone-100">
        {category.items.map((item) => {
          const soldOut = item.available === false;
          // One chip per diet: an older document (or a CSV import) can hold the
          // same label twice, which used to mean duplicate keys and two
          // identical chips on the diner's screen.
          const dietaryLabels = dedupeDietaryLabels(item.dietaryLabels);
          const variantName = variantChoice[item.id] ?? item.variants[0]?.name ?? null;
          const variant = variantName
            ? item.variants.find((candidate) => candidate.name === variantName)
            : null;
          const price = variant ? variant.price : item.price;
          const inCart = itemCount?.(item, variantName) ?? 0;
          const tick = flash[item.id] ?? 0;
          return (
            <li key={item.id} className={`px-5 py-3.5 ${soldOut ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <MenuItemPhoto item={item} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-ink-900">
                    <span>{item.name}</span>
                    {soldOut && (
                      <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                        Sold out
                      </span>
                    )}
                  </p>
                  {/* Clamped to two lines with a "More" control: a long
                      description must not push Add away from its dish (009). */}
                  {item.description && (
                    <ClampedDescription text={item.description} name={item.name} />
                  )}
                  {dietaryLabels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dietaryLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-900"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
                  {formatPreviewPrice(price, null, currency)}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.variants.length > 0 && (
                  <label className="text-xs text-ink-600">
                    <span className="sr-only">Size for {item.name}</span>
                    <select
                      value={variant?.name ?? ""}
                      onChange={(event) => onVariantChange(item.id, event.target.value)}
                      className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-ink-700 focus:border-amber-700 focus:outline-none"
                    >
                      {item.variants.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.name}
                          {option.price !== null
                            ? ` — ${formatPreviewPrice(option.price, null, currency)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="relative inline-flex">
                  {tick > 0 && (
                    <span
                      key={tick}
                      aria-hidden="true"
                      className="added-flash absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-green-800 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-white shadow"
                    >
                      Added ✓
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => {
                      onAdd(item);
                      bumpFlash(item.id);
                    }}
                    className="rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {inCart > 0 ? `Add · ${inCart}` : "Add"}
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function formatOrderTotal(currency: string | null, total: number | null): string {
  if (total === null) return "—";
  return formatPreviewPrice(total, null, currency);
}

/**
 * The cart shortcut for a one-column (phone) diner page: once something is in
 * the order, this bar shows the count and total and opens the order sheet.
 * A phone has no room for a cart beside the dishes, so "View order" is the
 * only way in there.
 *
 * Callers mount it only on narrow screens (`useWideLayout`); a wide page puts
 * the order in its own sticky column instead, and the bar would cover content
 * the panel already shows. The spacer reserves room at the end of the page so
 * the bar never covers the last dish.
 *
 * `contained` is for the owner-facing preview, which renders inside a phone
 * frame in the editor and wizard and is phone-shaped at every viewport width,
 * so it always needs the bar. There the viewport-bottom bar would float over
 * the app instead of the preview, so the bar sticks to the bottom of the
 * frame's own scroll area and the page does not need the spacer. Its `-mb-6`
 * cancels `OrderShell`'s bottom padding so the bar reaches the screen edge;
 * it is only correct inside that shell.
 */
export function StickyCartBar({
  itemCount,
  total,
  currency,
  contained = false,
  onViewOrder,
  buttonRef,
}: {
  itemCount: number;
  total: number | null;
  currency: string | null;
  contained?: boolean;
  /** Opens the order sheet; every cart lives there. */
  onViewOrder: () => void;
  /** Lets the caller return focus here after closing the order sheet. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  if (itemCount === 0) return null;

  const inner = (
    <div className="mx-auto flex w-full items-center gap-3">
      <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
        <span className="font-bold text-ink-900">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>{" "}
        · {formatOrderTotal(currency, total)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        onClick={onViewOrder}
        className="shrink-0 rounded-full bg-amber-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800 active:scale-95"
      >
        View order
      </button>
    </div>
  );

  if (contained) {
    return (
      <div
        className="sticky bottom-0 z-10 -mx-4 -mb-6 mt-auto border-t border-stone-200 bg-white/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {inner}
      </div>
    );
  }

  return (
    <>
      <div aria-hidden="true" className="h-16" />
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-4xl">{inner}</div>
      </div>
    </>
  );
}

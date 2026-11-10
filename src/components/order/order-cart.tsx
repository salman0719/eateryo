"use client";

/**
 * The cart, and the two places a diner can find it.
 *
 * A phone gets the bottom sheet (`OrderSheet`): one column of food, and the
 * order rises from the bottom edge when "View order" is pressed. A laptop or
 * tablet gets a second column beside the menu (`OrderCartPanel`): the order is
 * simply there, sticky, next to the dishes — no sheet, no hidden cart, nothing
 * to open.
 *
 * Both render `OrderCartLines`, so a change to a cart row cannot drift between
 * the two, and both take the caller's `footer` because what sits under the
 * total differs per page (send button, preview notice, server error).
 *
 * `useWideLayout` is the one place that picks between them, at the same `lg`
 * breakpoint the page grid uses for its second column.
 */

import { useSyncExternalStore } from "react";

import { formatPreviewPrice } from "@/features/menu/preview-utils";
import type { OrderLine } from "@/features/orders/schema";

/** Tailwind's `lg` — the width at which the page grid grows its cart column. */
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(WIDE_LAYOUT_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The server cannot know the viewport, so it renders the one-column page. */
function serverSnapshot(): boolean {
  return false;
}

/**
 * True on screens wide enough for the two-column diner page.
 *
 * The server renders false and the first client read settles it, which is
 * invisible in practice: a fresh page has an empty cart, so neither cart home
 * is showing anything yet. Callers use it to choose *one* home, so the kitchen
 * note never exists twice with the same id.
 */
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, () => mediaQuery()?.matches ?? false, serverSnapshot);
}

/** Unique per cart row: the same item in two menus is two rows. */
export function orderLineKey(line: OrderLine): string {
  return `${line.menuId ?? ""}:${line.menuItemId}:${line.variantName ?? "base"}`;
}

/**
 * The cart's rows and its kitchen note. Shared by the mobile sheet and the
 * desktop panel; the empty state and the footer are the caller's.
 */
export function OrderCartLines({
  lines,
  currency,
  showMenuBadges = false,
  onQuantityChange,
  note,
  onNoteChange,
  noteId,
}: {
  lines: readonly OrderLine[];
  /** Currency for line prices; null renders bare numbers rather than guessing. */
  currency: string | null;
  /** Multi-menu orders label each line with the menu it came from. */
  showMenuBadges?: boolean;
  onQuantityChange: (index: number, quantity: number) => void;
  note: string;
  onNoteChange: (note: string) => void;
  noteId: string;
}) {
  return (
    <>
      {lines.length > 0 && (
        <ul className="divide-y divide-line-100">
          {lines.map((line, index) => (
            <li key={orderLineKey(line)} className="py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 text-sm font-medium text-ink-900">
                  <span className="block truncate">
                    {line.name}
                    {line.variantName && (
                      <span className="ml-1 text-xs font-normal text-ink-500">
                        {line.variantName}
                      </span>
                    )}
                  </span>
                  {showMenuBadges && line.menuTitle && (
                    <span className="mt-0.5 inline-block rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                      {line.menuTitle.trim() || "Menu"}
                    </span>
                  )}
                </p>
                <p className="shrink-0 text-sm tabular-nums text-ink-800">
                  {line.unitPrice === null
                    ? "—"
                    : formatPreviewPrice(line.unitPrice * line.quantity, null, currency)}
                </p>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Decrease ${line.name}`}
                  onClick={() => onQuantityChange(index, line.quantity - 1)}
                  className="h-7 w-7 rounded-full border border-line-300 text-sm font-semibold text-ink-700 hover:border-accent-700"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                <button
                  type="button"
                  aria-label={`Increase ${line.name}`}
                  onClick={() => onQuantityChange(index, line.quantity + 1)}
                  className="h-7 w-7 rounded-full border border-line-300 text-sm font-semibold text-ink-700 hover:border-accent-700"
                >
                  +
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => onQuantityChange(index, 0)}
                  className="text-xs font-medium text-ink-500 underline hover:text-danger-800"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor={noteId} className="mt-3 block text-xs font-semibold text-ink-600">
        Note for the kitchen (optional)
      </label>
      <textarea
        id={noteId}
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        rows={2}
        maxLength={280}
        placeholder="Allergies, no onions…"
        className="mt-1 w-full rounded-xl border border-line-300 px-3 py-2 text-sm focus:border-accent-700 focus:outline-none"
      />
    </>
  );
}

/**
 * The cart as the right-hand column of a wide diner page: always visible,
 * sticky under the top of the viewport, and the only cart there — the bottom
 * bar and the sheet are phone furniture.
 *
 * It stays on screen before the first dish is added, saying so plainly, which
 * is how a diner on a laptop learns the order goes there.
 *
 * A long order can outgrow the window; because a sticky column pins to the top
 * edge, the part below the fold would be unreachable — including the send
 * button. So the panel caps at the viewport and scrolls its own rows instead.
 */
export function OrderCartPanel({
  lines,
  currency,
  subtitle,
  showMenuBadges = false,
  onQuantityChange,
  note,
  onNoteChange,
  noteId,
  footer,
}: {
  lines: readonly OrderLine[];
  currency: string | null;
  /** "Café · Table 3" under the title, when the caller knows it. */
  subtitle?: string;
  showMenuBadges?: boolean;
  onQuantityChange: (index: number, quantity: number) => void;
  note: string;
  onNoteChange: (note: string) => void;
  noteId: string;
  /** Total, warnings, errors and the send button. */
  footer: React.ReactNode;
}) {
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <aside
      aria-label="Your order"
      className="h-fit rounded-2xl border border-line-200 bg-surface-base p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink-900">Your order</h2>
        <span className="shrink-0 text-xs font-medium text-ink-500">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
      </div>
      {subtitle && <p className="mt-0.5 truncate text-xs text-ink-500">{subtitle}</p>}

      {lines.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-line-200 p-4 text-center text-sm text-ink-500">
          Nothing added yet.
        </p>
      )}

      <div className="mt-3">
        <OrderCartLines
          lines={lines}
          currency={currency}
          showMenuBadges={showMenuBadges}
          onQuantityChange={onQuantityChange}
          note={note}
          onNoteChange={onNoteChange}
          noteId={noteId}
        />
      </div>

      <div className="mt-4 border-t border-line-200 pt-3">{footer}</div>
    </aside>
  );
}

"use client";

import { formatItemPrice } from "@/features/menu/preview-utils";
import type { SearchResultRow } from "@/features/menu/search";

/**
 * The category pill row, and Results mode.
 *
 * The Reorder tab uses the pills to choose which category's dishes are being
 * arranged — a scope choice, which is what `selected` means. The Categories
 * tab no longer uses this row: its strip (`category-strip.tsx`) is a tab row
 * that scrolls and carries the search and the add button, because there one
 * category is on the canvas at a time.
 *
 * While a search is active the rows give way to `SearchResultsList`: one flat
 * list where every row carries its category pill, and picking a row selects
 * that dish.
 *
 * Presentational only — the editor owns query and selection.
 */

export interface CategoryPill {
  id: string;
  name: string;
  dishCount: number;
  /** The category this row currently applies to (the reorder scope). */
  selected: boolean;
}

export function CategoryPills({
  pills,
  onSelect,
}: {
  pills: readonly CategoryPill[];
  onSelect: (categoryId: string) => void;
}) {
  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Categories">
      {pills.map((pill) => (
        <button
          key={pill.id}
          type="button"
          aria-pressed={pill.selected}
          onClick={() => onSelect(pill.id)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
            pill.selected
              ? "border-accent-700 bg-accent-700 text-on-accent shadow-sm"
              : "border-line-300 bg-surface-base text-ink-600 hover:border-accent-700 hover:text-accent-900"
          }`}
        >
          <span className="max-w-40 truncate">{pill.name || "Untitled category"}</span>
          <span
            className={`rounded-full px-1.5 text-[11px] tabular-nums ${
              pill.selected ? "bg-accent-800 text-on-accent" : "bg-surface-100 text-ink-500"
            }`}
          >
            {pill.dishCount}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SearchResultsList({
  rows,
  currency,
  onPick,
}: {
  rows: readonly SearchResultRow[];
  currency: string | null;
  onPick: (row: SearchResultRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line-300 bg-surface-base px-4 py-6 text-center text-sm text-ink-500">
        No dishes match — try a shorter search.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.item.id}>
          <button
            type="button"
            onClick={() => onPick(row)}
            className="flex w-full items-center gap-3 rounded-xl border border-line-200 bg-surface-base px-3 py-2 text-left transition-colors hover:border-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink-900">
                {row.item.name}
              </span>
              <span className="mt-0.5 inline-block rounded-full bg-surface-100 px-2 py-px text-[11px] font-semibold text-ink-600">
                {row.categoryName || "Untitled category"}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
              {formatItemPrice(row.item, currency)}
            </span>
            <span aria-hidden="true" className="shrink-0 text-ink-400">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

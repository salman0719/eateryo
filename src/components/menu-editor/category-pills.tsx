"use client";

import { formatItemPrice } from "@/features/menu/preview-utils";
import type { SearchResultRow } from "@/features/menu/search";

/**
 * Step 3 of the redesign: the category pill row and Results mode.
 *
 * The pills name every category with its dish count; picking one jumps to
 * that section (the editor clears the search first, so a pill always shows
 * the category, never a filtered shadow of it). While a search is active the
 * sections give way to `SearchResultsList`: one flat list where every row
 * carries its category pill, and picking a row jumps to that dish.
 *
 * Presentational only — the editor owns query, fold, and scrolling.
 */

export interface CategoryPill {
  id: string;
  name: string;
  dishCount: number;
  open: boolean;
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
          aria-pressed={pill.open}
          onClick={() => onSelect(pill.id)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
            pill.open
              ? "border-accent-700 bg-accent-50 text-accent-900"
              : "border-line-300 bg-surface-base text-ink-600 hover:border-accent-700 hover:text-accent-900"
          }`}
        >
          <span className="max-w-40 truncate">{pill.name || "Untitled category"}</span>
          <span
            className={`rounded-full px-1.5 text-[11px] tabular-nums ${
              pill.open ? "bg-accent-100 text-accent-900" : "bg-surface-100 text-ink-500"
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

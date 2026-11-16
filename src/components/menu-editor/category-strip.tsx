"use client";

import type { RefObject } from "react";

/**
 * Step 14 of the redesign: the Categories tab's one-line strip.
 *
 * Category tabs on the left (they scroll sideways on a phone rather than
 * wrapping to four rows), the menu-wide search on the right, and
 * "+ Category" at the end — the prototype's `.catstrip`. A tab *names* the
 * category on the canvas; it does not fold a section, which is why the old
 * Expand all / Collapse all pair is gone: with one category on the canvas
 * there is nothing to expand.
 *
 * Presentational: the editor owns the query, the selection and the input ref.
 */

export interface CategoryTab {
  id: string;
  name: string;
  dishCount: number;
}

export function CategoryStrip({
  tabs,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  searchInputRef,
  onAddCategory,
  matchCount,
  totalItems,
}: {
  tabs: readonly CategoryTab[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** The editor's ref, so "/" focuses this field from anywhere. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  onAddCategory: () => void;
  /** Matches shown while searching; read only while the query is non-empty. */
  matchCount: number;
  totalItems: number;
}) {
  const filtering = query.trim().length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav
        aria-label="Categories"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
      >
        {tabs.map((tab) => {
          const selected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(tab.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                selected
                  ? "border-accent-700 bg-accent-50 text-accent-900"
                  : "border-line-300 bg-surface-base text-ink-600 hover:border-accent-700 hover:text-accent-900"
              }`}
            >
              <span className="max-w-40 truncate">{tab.name || "Untitled category"}</span>
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  selected ? "bg-accent-100 text-accent-900" : "bg-surface-100 text-ink-500"
                }`}
              >
                {tab.dishCount}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <label htmlFor="menu-search" className="sr-only">
          Search the menu
        </label>
        <input
          id="menu-search"
          ref={searchInputRef}
          aria-keyshortcuts="/"
          title="Search the menu (press / to focus)"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search items, descriptions, or categories…"
          className="min-w-0 flex-1 rounded-full border border-line-300 bg-surface-base px-4 py-1.5 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-700 focus:outline-none sm:w-64 sm:flex-none"
        />
        {filtering && (
          <>
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="shrink-0 rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Clear
            </button>
            <p role="status" className="shrink-0 text-xs font-medium text-ink-500 tabular-nums">
              {matchCount} of {totalItems}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={onAddCategory}
          className="shrink-0 rounded-full border border-line-300 px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          + Category
        </button>
      </div>
    </div>
  );
}

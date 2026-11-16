"use client";

import { memo } from "react";

import { hasAnyPrice, isItemFlagged } from "@/features/menu/menu-utils";
import { formatItemPrice } from "@/features/menu/preview-utils";
import type { MenuItem } from "@/features/menu/schema";
import { itemImageCopy } from "@/features/item-images/ref";

/**
 * Step 14 of the redesign: one dish, shut.
 *
 * The row is the whole dish at a glance — name, shape, price, and the flags
 * that need attention — because its fields now live in the inspector beside
 * it, not in a form that unfolds underneath. Selecting the row shows the dish
 * in the inspector; nothing in the row itself changes the document.
 *
 * Memoized: a menu can hold a few hundred dishes, and selecting one must not
 * re-render the others.
 */

/** What a row can ask the editor to do, addressed by id. */
export interface DishRowActions {
  /** Show this dish in the inspector. */
  select: (itemId: string) => void;
  /** Tick or untick this dish for a bulk move. */
  toggleSelected: (itemId: string) => void;
}

export const DishRow = memo(function DishRow({
  item,
  currency,
  selected,
  bulkSelected,
  duplicate,
  actions,
}: {
  item: MenuItem;
  currency: string | null;
  /** Showing in the inspector right now. */
  selected: boolean;
  /** Ticked for a bulk move (see the editor's bulk actions bar). */
  bulkSelected: boolean;
  /** Flagged by duplicate detection (review-only badge, see duplicates.ts). */
  duplicate: boolean;
  actions: DishRowActions;
}) {
  const needsReview = isItemFlagged(item);
  const copy = itemImageCopy(item.image);

  /**
   * What the row says under the name: the shape of the dish only, so a row
   * whose fields are elsewhere still says it has sizes and option groups. The
   * description belongs to the inspector (and to search), not to every row.
   */
  const shape: string[] = [];
  if (item.variants.length > 0) {
    shape.push(`${item.variants.length} ${item.variants.length === 1 ? "size" : "sizes"}`);
  }
  if (item.options.length > 0) {
    const choiceCount = item.options.reduce((sum, group) => sum + group.choices.length, 0);
    shape.push(
      `${item.options.length} ${item.options.length === 1 ? "option group" : "option groups"} · ${choiceCount} ${choiceCount === 1 ? "choice" : "choices"}`
    );
  }
  const rowShape = shape.join(" · ");

  return (
    <li
      id={`menu-item-${item.id}`}
      className={`flex items-center gap-2 border-l-2 pl-1 transition-colors sm:pl-2 ${
        selected
          ? "border-l-accent-700 bg-accent-50"
          : bulkSelected
            ? "border-l-transparent bg-warning-50/70"
            : "border-l-transparent"
      }`}
    >
      <label
        title="Select for bulk move"
        className="flex min-h-[32px] min-w-[28px] cursor-pointer items-center justify-center pointer-coarse:min-h-[44px]"
      >
        <input
          type="checkbox"
          checked={bulkSelected}
          onChange={() => actions.toggleSelected(item.id)}
          aria-label={`Select ${item.name} for bulk move`}
          className="h-4 w-4 rounded border-line-300 accent-accent-700"
        />
      </label>
      {copy ? (
        // eslint-disable-next-line @next/next/no-img-element -- dish photo served straight from the CDN at its stored size; the optimizer must never touch it
        <img
          src={copy.url}
          alt=""
          width={copy.width}
          height={copy.height}
          loading="lazy"
          decoding="async"
          className="h-8 w-8 shrink-0 rounded-md border border-line-200 object-cover"
        />
      ) : null}
      <button
        type="button"
        onClick={() => actions.select(item.id)}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-ink-900">
              {item.name || "Untitled item"}
            </span>
            {needsReview && (
              <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900">
                {hasAnyPrice(item) ? "Couldn't read" : "Check price"}
              </span>
            )}
            {duplicate && (
              <span className="rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-medium text-danger-900">
                Possible duplicate
              </span>
            )}
          </span>
          {rowShape && (
            <span className="mt-0.5 block truncate text-xs text-ink-500">{rowShape}</span>
          )}
        </span>
        <span className="shrink-0 text-sm whitespace-nowrap tabular-nums text-ink-600">
          {formatItemPrice(item, currency)}
        </span>
        <span aria-hidden="true" className="shrink-0 text-ink-400">
          ›
        </span>
      </button>
    </li>
  );
});

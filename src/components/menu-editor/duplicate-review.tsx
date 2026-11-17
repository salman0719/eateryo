"use client";

import type { MenuItem } from "@/features/menu/schema";
import type { DuplicateGroup } from "@/features/menu/duplicates";

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Step 8 of the redesign: the duplicate review, living on the Categories
 * tab only. Detection only flags (see duplicates.ts) — each group offers
 * Keep all (dismiss, remembered per document) or Delete this copy, which
 * runs through the editor's usual confirmed delete with one-level undo.
 * No logic lives here; the editor owns groups, dismissal, and deletion.
 */
export function DuplicateReview({
  groups,
  currency,
  onKeepGroup,
  onDeleteCopy,
}: {
  groups: DuplicateGroup[];
  currency: string | null;
  onKeepGroup: (key: string) => void;
  onDeleteCopy: (categoryId: string, item: MenuItem) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <section
      aria-label="Possible duplicates"
      className="rounded-2xl border border-warning-300 bg-warning-50/70 p-4"
    >
      <p className="text-sm font-semibold text-warning-900">
        {groups.length === 1
          ? "1 possible duplicate found — review it; nothing is deleted automatically."
          : `${groups.length} possible duplicates found — review them; nothing is deleted automatically.`}
      </p>
      <ul className="mt-3 space-y-3">
        {groups.map((group) => (
          <li key={group.key} className="rounded-xl border border-warning-200 bg-surface-base p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-ink-900">
                “{group.displayName}” appears {group.occurrences.length} times
              </p>
              <span className="flex-1" />
              <button type="button" onClick={() => onKeepGroup(group.key)} className={smallButton}>
                Keep all
              </button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {group.occurrences.map((occurrence) => (
                <li
                  key={occurrence.item.id}
                  className="flex flex-wrap items-center gap-2 text-sm text-ink-700"
                >
                  <span className="min-w-[160px] flex-1">
                    {occurrence.item.name}
                    <span className="text-xs text-ink-500">
                      {" "}
                      in {occurrence.categoryName}
                      {occurrence.item.price !== null &&
                        ` · ${occurrence.item.currency ?? currency ?? ""}${occurrence.item.price}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteCopy(occurrence.categoryId, occurrence.item)}
                    className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                  >
                    Delete this copy
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

"use client";

import { HeightReveal } from "@/components/ui/height-reveal";

/**
 * The post-sign-in notice after the automatic import: sign-in claims every
 * unseen browser draft in one go, so there is no offer. It never claims
 * that a menu is on another device before the server has accepted it.
 */

export interface LocalDraftClaimNotice {
  /** Menus the server accepted in this run. */
  imported: number;
  /** Menus that could not be imported (already reported per menu by name). */
  failed: number;
  restaurantName: string;
}

function menuCountLabel(count: number): string {
  return count === 1 ? "1 menu" : `${count} menus`;
}

export function LocalDraftsNotice({
  notice,
  onOpenLibrary,
  onDismiss,
}: {
  notice: LocalDraftClaimNotice;
  onOpenLibrary: () => void;
  onDismiss: () => void;
}) {
  const nothingImported = notice.imported === 0 && notice.failed === 0;

  return (
    <HeightReveal>
      <section
        role="status"
        aria-label="Menus from this browser"
        data-print-hide
        className="rounded-2xl border border-line-200 bg-surface-base px-4 py-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success-700" />
              {nothingImported
                ? "Those browser menus are already on your account"
                : `Added ${menuCountLabel(notice.imported)} from this browser`}
            </p>
            <p className="mt-1 max-w-xl text-xs leading-5 text-ink-600">
              {nothingImported
                ? `“${notice.restaurantName}” already holds them.`
                : `They're now on your account under “${notice.restaurantName}” and work on your other devices.`}
            </p>
            {notice.failed > 0 && (
              <p className="mt-1 text-xs font-medium leading-5 text-warning-900">
                {menuCountLabel(notice.failed)} could not be added. Open My menus and use “Import
                from this browser” to try again.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenLibrary}
              className="rounded-full border border-line-300 bg-surface-base px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Open My menus
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      </section>
    </HeightReveal>
  );
}

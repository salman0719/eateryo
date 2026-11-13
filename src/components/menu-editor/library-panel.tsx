"use client";

import { useConfirm } from "@/components/ui/confirm-dialog";

import { Skeleton } from "@/components/ui/skeleton";
import type { MenuSummary } from "@/features/menu/storage";

import { suggestSecondMenuNames } from "@/features/menu/menu-utils";

import { CommitInput } from "./fields";

/**
 * A library row: the browser summary plus whether the account holds it. The
 * second field is only meaningful when `accountMode` is on — before the
 * account's menu list has been read, it is `false` because nobody asked.
 */
export interface LibraryMenu extends MenuSummary {
  onServer: boolean;
  /**
   * False when the server says this caller may not change the menu. A row
   * without an answer is never offered a write; the shell fills this from
   * the same capabilities the editor uses.
   */
  canWrite?: boolean;
}

interface LibraryPanelProps {
  menus: LibraryMenu[];
  /** True until the first library read settles — rows skeleton, never the empty state. */
  loading?: boolean;
  /**
   * Signed in *and* the account's menu list has actually been read: only then
   * may a row name its membership. False covers both "signed out" and "not
   * answered yet", so nothing claims "this browser only" on a guess.
   */
  accountMode: boolean;
  /**
   * Whether this membership may start a menu (`menus.write`). A staff shift
   * reads the café's published menus; it never creates a draft, so the
   * creation controls are absent rather than disabled.
   */
  canCreate?: boolean;
  /** Signed out with stamped rows hidden: say so instead of "no menus". */
  hasHiddenMenus?: boolean;
  unavailable: boolean;
  /** Overrides the empty state when the shell knows why there is nothing. */
  emptyTitle?: string;
  emptyBody?: string;
  onOpen: (id: string) => void;
  /** Optional service name from the second-menu chips (Lunch, Dinner…). */
  onNew: (suggestedTitle?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  if (!iso) return "unknown date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toLocaleString();
}

export function LibraryPanel({
  menus,
  loading = false,
  accountMode,
  canCreate = true,
  hasHiddenMenus = false,
  unavailable,
  emptyTitle,
  emptyBody,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: LibraryPanelProps) {
  const { confirm, dialog } = useConfirm();

  // Q2 companion: the second menu gets a contextual ask, not a bare
  // duplicate — chips name it for its service, the button keeps numbering.
  const secondMenuSuggestions =
    canCreate && menus.length > 0 && !loading
      ? suggestSecondMenuNames(menus.map((menu) => menu.title))
      : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-ink-900">My menus</h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => onNew()}
            disabled={unavailable}
            className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            + New menu
          </button>
        )}
      </div>

      {secondMenuSuggestions.length > 0 && (
        <div className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3">
          <p className="text-sm text-ink-700">
            Adding another?{" "}
            <span className="font-medium">Is it for a different time or service?</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {secondMenuSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onNew(name)}
                disabled={unavailable}
                className="rounded-full border border-line-300 bg-surface-base px-3 py-1 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {unavailable && (
        <p
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          Browser storage isn&apos;t available, so menus can&apos;t be saved here. You can still
          extract and export, but everything will be lost on refresh.
        </p>
      )}

      {loading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading your menus…</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-2xl border border-line-200 bg-surface-base p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-2/5" />
                  <Skeleton className="mt-2 h-3 w-3/5" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-16 rounded-full" />
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : menus.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-200 bg-surface-base p-8 text-center">
          <p className="font-medium text-ink-900">
            {emptyTitle ??
              (hasHiddenMenus
                ? accountMode
                  ? "No menus for this account"
                  : "Signed out"
                : "No saved menus yet")}
          </p>
          <p className="mt-1 text-sm text-ink-600">
            {emptyBody ??
              (hasHiddenMenus
                ? accountMode
                  ? "This device holds menus for another account. Sign in as that account to see them."
                  : "Your menus reappear when you sign in."
                : "Extract a menu or start a blank one — it will appear here and survive refreshes.")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {menus.map((menu) => (
            <li key={menu.id} className="rounded-2xl border border-line-200 bg-surface-base p-4">
              {menu.corrupt ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink-900">Unreadable record</p>
                    <p className="text-xs text-ink-500">
                      Damaged or from an incompatible version — it can only be deleted.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        message: "Delete this unreadable record?",
                        confirmLabel: "Delete",
                        destructive: true,
                      });
                      if (ok) onDelete(menu.id);
                    }}
                    className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div className="w-full min-w-0 flex-1 sm:w-auto">
                    {menu.canWrite === false ? (
                      <p className="text-sm font-semibold text-ink-900">{menu.title}</p>
                    ) : (
                      <CommitInput
                        label={`Rename menu “${menu.title}”`}
                        value={menu.title}
                        onCommit={(title) => onRename(menu.id, title.trim())}
                      />
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span>
                        {menu.categoryCount} {menu.categoryCount === 1 ? "category" : "categories"}{" "}
                        · {menu.itemCount} {menu.itemCount === 1 ? "item" : "items"} · updated{" "}
                        {formatDate(menu.updatedAt)}
                      </span>
                      {menu.canWrite === false && (
                        <span className="whitespace-nowrap rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                          View only
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(menu.id)}
                      className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                    >
                      Open
                    </button>
                    {menu.canWrite !== false && (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await confirm({
                            message: `Delete “${menu.title}” permanently? Export a JSON backup first if it matters.`,
                            confirmLabel: "Delete menu",
                            destructive: true,
                          });
                          if (ok) onDelete(menu.id);
                        }}
                        className="rounded-full border border-line-300 px-4 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { Skeleton } from "@/components/ui/skeleton";
import type { MenuSummary } from "@/features/menu/storage";
import type { RestaurantOption } from "@/features/tenancy/client";

import { suggestSecondMenuNames } from "@/features/menu/menu-utils";

import { CommitInput } from "./fields";

/**
 * A library row: the browser summary plus whether the account holds it. The
 * second field is only meaningful when `accountMode` is on — before the
 * account's menu list has been read, it is `false` because nobody asked.
 */
export interface LibraryMenu extends MenuSummary {
  onServer: boolean;
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
  /** Signed out with stamped rows hidden: say so instead of "no menus". */
  hasHiddenMenus?: boolean;
  /** Restaurants the caller owns — where a per-row add can put a menu. */
  ownedRestaurants?: RestaurantOption[];
  /**
   * Add one browser-only menu to a restaurant. Resolves to a message to
   * show on that row, or null when the add succeeded (or was already there).
   */
  onMoveToAccount?: (menuId: string, restaurantId: string) => Promise<string | null>;
  unavailable: boolean;
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
  hasHiddenMenus = false,
  ownedRestaurants = [],
  onMoveToAccount,
  unavailable,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: LibraryPanelProps) {
  const { confirm, dialog } = useConfirm();
  /** The row whose restaurant picker is open (one add at a time). */
  const [pickerMenuId, setPickerMenuId] = useState<string | null>(null);

  const [targetId, setTargetId] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);
  const moveAvailable = onMoveToAccount != null && ownedRestaurants.length > 0;

  // Q2 companion: the second menu gets a contextual ask, not a bare
  // duplicate — chips name it for its service, the button keeps numbering.
  const secondMenuSuggestions =
    menus.length > 0 && !loading ? suggestSecondMenuNames(menus.map((menu) => menu.title)) : [];

  function startMove(id: string) {
    setMoveError(null);
    const only = ownedRestaurants.length === 1 ? ownedRestaurants[0] : undefined;
    if (only) {
      // One restaurant means no choice to make: add straight away.
      setTargetId(only.id);
      void runMove(id, only.id);
      return;
    }
    setTargetId("");
    setPickerMenuId(id);
  }

  async function runMove(id: string, restaurantId: string) {
    if (!restaurantId || !onMoveToAccount || movingId !== null) return;
    setMovingId(id);
    setMoveError(null);
    try {
      const message = await onMoveToAccount(id, restaurantId);
      if (message) setMoveError({ id, message });
      else setPickerMenuId(null);
    } catch {
      setMoveError({
        id,
        message: "Could not add that menu. Check your connection and try again.",
      });
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-ink-900">My menus</h2>
        <button
          type="button"
          onClick={() => onNew()}
          disabled={unavailable}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          + New menu
        </button>
      </div>

      {secondMenuSuggestions.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-surface-50 px-4 py-3">
          <p className="text-sm text-ink-700">
            Adding another? <span className="font-medium">Is it for a different time or service?</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {secondMenuSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onNew(name)}
                disabled={unavailable}
                className="rounded-full border border-stone-300 bg-surface-base px-3 py-1 text-sm font-medium text-ink-700 transition-colors hover:border-amber-700 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
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
            <div key={row} className="rounded-2xl border border-stone-200 bg-surface-base p-4">
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
        <div className="rounded-2xl border border-dashed border-stone-300 bg-surface-base p-8 text-center">
          <p className="font-medium text-ink-900">
            {hasHiddenMenus ? "Signed out" : "No saved menus yet"}
          </p>
          <p className="mt-1 text-sm text-ink-600">
            {hasHiddenMenus
              ? "Your menus reappear when you sign in."
              : "Extract a menu or start a blank one — it will appear here and survive refreshes."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {menus.map((menu) => (
            <li key={menu.id} className="rounded-2xl border border-stone-200 bg-surface-base p-4">
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
                    className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div className="w-full min-w-0 flex-1 sm:w-auto">
                    <CommitInput
                      label={`Rename menu “${menu.title}”`}
                      value={menu.title}
                      onCommit={(title) => onRename(menu.id, title.trim())}
                    />
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span>
                        {menu.categoryCount} {menu.categoryCount === 1 ? "category" : "categories"}{" "}
                        · {menu.itemCount} {menu.itemCount === 1 ? "item" : "items"} · updated{" "}
                        {formatDate(menu.updatedAt)}
                      </span>
                      {accountMode && (
                        <span
                          className={
                            menu.onServer
                              ? "whitespace-nowrap rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-900"
                              : "whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                          }
                        >
                          {menu.onServer ? "On your account" : "This browser only"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Only a read that proved membership may offer the move:
                        while it is unknown, "not on the account" is a guess. */}
                    {accountMode && !menu.onServer && moveAvailable && (
                      <button
                        type="button"
                        onClick={() => startMove(menu.id)}
                        disabled={movingId !== null}
                        className="rounded-full border border-amber-700 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                      >
                        {movingId === menu.id ? "Adding…" : "Add to account"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpen(menu.id)}
                      className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      Open
                    </button>
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
                      className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
              {pickerMenuId === menu.id && (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-stone-200 bg-surface-50 p-3 sm:flex-row sm:items-end">
                  <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-ink-600">
                    Add “{menu.title}” to
                    <select
                      value={targetId}
                      onChange={(event) => setTargetId(event.target.value)}
                      className="rounded-lg border border-stone-300 bg-surface-base px-3 py-1.5 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      <option value="" disabled>
                        Choose a restaurant…
                      </option>
                      {ownedRestaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>
                          {restaurant.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runMove(menu.id, targetId)}
                      disabled={!targetId || movingId !== null}
                      className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      {movingId === menu.id ? "Adding…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickerMenuId(null)}
                      disabled={movingId !== null}
                      className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:border-stone-400 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {moveError?.id === menu.id && (
                <p role="alert" className="mt-2 text-xs text-danger-700">
                  {moveError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}

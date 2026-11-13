"use client";

import type { ComponentProps } from "react";

import { LibraryPanel } from "@/components/menu-editor/library-panel";
import { MoveToAccountPanel } from "@/components/menu-editor/move-to-account-panel";
import { isSessionGateMessage } from "@/features/session/state";
import type { MoveReport } from "@/features/menus/move-to-account";
import type { RestaurantOption } from "@/features/tenancy/client";

type PanelProps = ComponentProps<typeof LibraryPanel>;

export interface MenusPageProps {
  /** A refusal or read error from the shell's library/account reads. */
  error: string | null;
  menus: PanelProps["menus"];
  loading: boolean;
  accountMode: boolean;
  /** Whether this membership may start a menu (`menus.write`). */
  canCreate: boolean;
  hasHiddenMenus: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  signedIn: boolean;
  /** The currently visible browser-only rows, for the manual import. */
  importCount: number;
  importMenuIds: string[];
  suggestedName: string | null;
  ownedRestaurants: RestaurantOption[];
  unavailable: boolean;
  onOpen: PanelProps["onOpen"];
  onNew: PanelProps["onNew"];
  onRename: PanelProps["onRename"];
  onDelete: PanelProps["onDelete"];
  onMoveToAccount: PanelProps["onMoveToAccount"];
  /** Called after an import that copied at least one menu (stamp + refresh). */
  onMoved: (report: MoveReport) => void;
  /**
   * Signed-out sign-in path. When the shell hands this over, the session-gate
   * button asks about the browser draft first instead of linking away.
   */
  onSignIn?: () => void;
}

/**
 * My menus: the library plus the manual "Import from this browser" fallback.
 * The page is presentational — the shell owns the menu set, the claim state
 * and the account merge — so opening a row or importing never duplicates
 * state here.
 */
export function MenusPage({
  error,
  menus,
  loading,
  accountMode,
  canCreate,
  hasHiddenMenus,
  emptyTitle,
  emptyBody,
  signedIn,
  importCount,
  importMenuIds,
  suggestedName,
  ownedRestaurants,
  unavailable,
  onOpen,
  onNew,
  onRename,
  onDelete,
  onMoveToAccount,
  onMoved,
  onSignIn,
}: MenusPageProps) {
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          {error}{" "}
          {isSessionGateMessage(error) &&
            (onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="font-semibold text-danger-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-900"
              >
                Sign in
              </button>
            ) : (
              <a
                href="/sign-in"
                className="font-semibold text-danger-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-900"
              >
                Sign in
              </a>
            ))}
        </p>
      )}
      <LibraryPanel
        menus={menus}
        loading={loading}
        accountMode={accountMode}
        canCreate={canCreate}
        hasHiddenMenus={hasHiddenMenus}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        ownedRestaurants={signedIn ? ownedRestaurants : []}
        onMoveToAccount={onMoveToAccount}
        unavailable={unavailable}
        onOpen={onOpen}
        onNew={onNew}
        onRename={onRename}
        onDelete={onDelete}
      />
      {/* The manual route stays available, quietly: the post-sign-in offer
          handles the common case, and this is where a partial import is
          retried. */}
      {signedIn && accountMode && importCount > 0 && (
        <details className="rounded-2xl border border-line-200 bg-surface-base">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-700 marker:text-ink-400">
            Import from this browser
            <span className="ml-2 rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
              {importCount}
            </span>
          </summary>
          <div className="border-t border-line-200">
            <MoveToAccountPanel
              menuCount={importCount}
              menuIds={importMenuIds}
              suggestedName={suggestedName}
              onMoved={onMoved}
            />
          </div>
        </details>
      )}
    </div>
  );
}

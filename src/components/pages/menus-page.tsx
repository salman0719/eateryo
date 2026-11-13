"use client";

import type { ComponentProps } from "react";

import { LibraryPanel } from "@/components/menu-editor/library-panel";
import { isSessionGateMessage } from "@/features/session/state";

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
  unavailable: boolean;
  onOpen: PanelProps["onOpen"];
  onNew: PanelProps["onNew"];
  onRename: PanelProps["onRename"];
  onDelete: PanelProps["onDelete"];
  /**
   * Signed-out sign-in path. When the shell hands this over, the session-gate
   * button asks about the browser draft first instead of linking away.
   */
  onSignIn?: () => void;
}

/**
 * My menus: the library, presentational — the shell owns the menu set
 * and the account merge, so opening a row never duplicates state here.
 * Browser drafts join the account at sign-in; there is no manual import.
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
  unavailable,
  onOpen,
  onNew,
  onRename,
  onDelete,
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
        unavailable={unavailable}
        onOpen={onOpen}
        onNew={onNew}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

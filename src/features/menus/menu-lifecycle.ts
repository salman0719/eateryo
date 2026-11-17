"use client";

import { useEffect, useRef } from "react";

import { createMenuDocument, defaultNewMenuTitle } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import {
  deleteMenu as deleteStoredMenu,
  listMenus,
  renameMenu as renameStoredMenu,
  StorageError,
} from "@/features/menu/storage";
import {
  clearDraftOrigin,
  menuContentHash,
  refreshDraftSync,
  stampDraftOrigin,
} from "@/features/menus/draft-origins";
import { useLibrary } from "@/features/menus/library-context";
import { rememberPendingNewMenu } from "@/features/menus/routed-doc";
import {
  deleteServerMenu,
  fetchServerMenu,
  SyncError,
  updateServerMenu,
} from "@/features/menus/sync";
import { routeMenuId } from "@/features/navigation/routes";
import { useNavigation } from "@/features/navigation/navigation-context";
import { accessCan, type MenuAccess } from "@/features/tenancy/access";
import { workspaceCan } from "@/features/tenancy/workspace";
import { useWorkspace } from "@/features/tenancy/workspace-context";

/**
 * The library's verbs on a menu row — open, start, rename, delete — and the
 * one membership the shell acts in. A menu row is not the document inside it:
 * a rename or a delete can name a menu the editor does not hold, so these are
 * the operations that must work from the library alone.
 *
 * The document itself stays with `useActiveMenu` and arrives as doors. None of
 * them is mirrored here: `forgetOpenDoc` closes a deleted row, `onMenuRenamed`
 * keeps an open one in step, and the baseline pair is how a rename pushed from
 * the list continues from the revision the account agreed on.
 */
export type MenuLifecycleOptions = {
  /** The id of the document the editor holds, or null (state, never a ref). */
  openDocId: string | null;
  /** Make a document the open one. A new menu is created by its first change. */
  openDoc(
    doc: MenuDocument,
    imageBlob: Blob | null,
    updateRoute?: boolean,
    accessHint?: MenuAccess
  ): Promise<void>;
  /** A deleted menu cannot stay open. */
  forgetOpenDoc(id: string): void;
  /** A rename made in the library lands on the open document too. */
  onMenuRenamed(renamed: MenuDocument): void;
  /** The agreed revision to stamp a rename with, when `id` is the open menu. */
  openBaseline(id: string): string;
  /** The server agreed on a revision for a menu. */
  onServerRevision(menuId: string, serverUpdatedAt: string): void;
};

export function useMenuLifecycle(options: MenuLifecycleOptions) {
  const { signedIn, accountKey, active, workspaces, switchTo, pending } = useWorkspace();
  const {
    menus,
    serverIdsRef,
    menuAccessRef,
    menuRestaurantById,
    refreshLibrary,
    reportLibraryError,
    removeServerId,
  } = useLibrary();
  const { route, navigate } = useNavigation();

  /** Session answers for async work that finishes after an await. */
  const signedInRef = useRef(signedIn);
  const accountKeyRef = useRef<string | null>(accountKey);
  useEffect(() => {
    signedInRef.current = signedIn;
    accountKeyRef.current = accountKey;
  }, [signedIn, accountKey]);

  const accountAccessPending = signedIn && pending;

  // --- Rows ---------------------------------------------------------------

  /** Open a row in the editor, clearing any library error it answers. */
  function openMenu(id: string) {
    reportLibraryError(null);
    navigate({ screen: "editor", menuId: id, mode: "edit" });
  }

  async function newMenu(suggestedTitle?: string) {
    reportLibraryError(null);
    if (!signedInRef.current) {
      // Replacement, not accumulation: the old offline draft goes away now
      // so the new blank slate is the browser's one menu. No confirmation —
      // starting over is the whole point of this button.
      try {
        const all = await listMenus();
        await Promise.all(all.map((menu) => deleteStoredMenu(menu.id).catch(() => undefined)));
        await refreshLibrary();
      } catch {
        // A failed delete surfaces on the next save's prune instead.
      }
    }
    // Q2: never gate on a name — blank menus arrive titled ("Main Menu"
    // first, honest numbering after) and rename inline in the editor.
    const fallback = defaultNewMenuTitle(menus.map((menu) => menu.title));
    const title = suggestedTitle?.trim() ? suggestedTitle.trim() : fallback;
    // The menu is created by its first change, not by this tap: it lives in
    // memory until an edit persists it through the normal autosave path, so
    // going back now leaves no row, no banner, nothing to finish. The marker
    // tells a refresh that the URL may name an unsaved menu, so it lands
    // back in the library quietly instead of reporting it missing.
    const doc = createMenuDocument({ title });
    rememberPendingNewMenu(doc.id);
    await options.openDoc(doc, null, true, "local");
  }

  async function renameMenu(id: string, title: string) {
    const access = menuAccessRef.current.get(id);
    if (signedInRef.current && access !== "local" && !accessCan(access, "menus.write")) {
      reportLibraryError("Only someone with menu access can rename this menu.");
      return;
    }
    try {
      const renamed = await renameStoredMenu(id, title);
      const renameActor = signedInRef.current ? accountKeyRef.current : null;
      if (renameActor && accessCan(menuAccessRef.current.get(id), "menus.write")) {
        // Keep the existing baseline when this menu is not open: the
        // editor's baseline belongs to another document.
        await stampDraftOrigin(id, renameActor, options.openBaseline(id));
      }
      if (signedInRef.current && serverIdsRef.current.has(id)) {
        await pushRenameToAccount(renamed);
      }
      await refreshLibrary();
      options.onMenuRenamed(renamed);
    } catch (error) {
      reportLibraryError(
        error instanceof StorageError ? error.message : "Could not rename that menu."
      );
    }
  }

  /**
   * Push a library rename to the account. The base revision is fetched
   * first — a library rename can target a menu the editor doesn't have
   * open, so there is no `serverBaseRef` to lean on. A conflict is
   * reported, never overwritten; it resolves on the next editor open,
   * which adopts the account revision. The local rename always stands.
   */
  async function pushRenameToAccount(renamed: MenuDocument) {
    try {
      const serverMenu = await fetchServerMenu(renamed.id);
      try {
        const pushed = await updateServerMenu(renamed.id, renamed, serverMenu.updatedAt);
        options.onServerRevision(renamed.id, pushed.updatedAt);
        const renameSyncActor = accountKeyRef.current;
        if (renameSyncActor)
          await refreshDraftSync(
            renamed.id,
            renameSyncActor,
            pushed.updatedAt,
            menuContentHash(renamed)
          );
      } catch (error) {
        if (error instanceof SyncError && error.code === "not_found") {
          removeServerId(renamed.id); // Gone on the server; nothing to push.
        } else if (error instanceof SyncError && error.code === "conflict") {
          reportLibraryError(
            "Renamed in this browser — it changed on your other device. Open the menu to reconcile."
          );
        } else if (error instanceof SyncError && error.code === "forbidden") {
          reportLibraryError(
            "Renamed in this browser — only the restaurant owner can rename it on your account."
          );
        } else if (error instanceof SyncError && error.code === "unauthorized") {
          reportLibraryError(
            "Renamed in this browser — sign in again to rename it on your account."
          );
        } else {
          reportLibraryError(
            "Renamed in this browser — the change could not be saved to your account. Try again when online."
          );
        }
      }
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(renamed.id);
        return;
      }
      reportLibraryError(
        "Renamed in this browser — your account could not be reached. Try again when online."
      );
    }
  }

  async function deleteMenu(id: string) {
    const access = menuAccessRef.current.get(id);
    if (signedInRef.current && access !== "local" && !accessCan(access, "menus.write")) {
      reportLibraryError("Only someone with menu access can delete this menu.");
      return;
    }
    try {
      // Remove it from the account first when it is there, so a failure is
      // reported before the browser copy is gone. The browser delete always
      // proceeds — it is the user's data and their explicit intent.
      let accountNote: string | null = null;
      if (signedInRef.current && serverIdsRef.current.has(id)) {
        try {
          await deleteServerMenu(id);
          removeServerId(id);
        } catch (error) {
          if (error instanceof SyncError && error.code === "not_found") {
            removeServerId(id); // Already gone on the server.
          } else if (error instanceof SyncError && error.code === "forbidden") {
            accountNote =
              "Deleted from this browser — only the restaurant owner can remove it from your account.";
          } else if (error instanceof SyncError && error.code === "unauthorized") {
            accountNote =
              "Deleted from this browser — sign in again to remove it from your account.";
          } else {
            accountNote =
              "Deleted from this browser — it could not be removed from your account. Try again when online.";
          }
        }
      }
      await deleteStoredMenu(id);
      await clearDraftOrigin(id);
      removeServerId(id);
      options.forgetOpenDoc(id);
      await refreshLibrary();
      if (accountNote) reportLibraryError(accountNote);
      navigate({ screen: "library" }, { flushCurrent: false });
    } catch (error) {
      reportLibraryError(
        error instanceof StorageError ? error.message : "Could not delete that menu."
      );
    }
  }

  // --- The one membership the shell acts in -------------------------------

  /**
   * Switch the membership the shell acts in. Stored under the account, so a
   * staff context chosen on a shared device never greets the next person.
   *
   * The open editor belongs to its menu's café, so switching to a different
   * one leaves the editor for the new café's library instead of keeping a
   * menu on screen under a café it does not belong to. A browser-only draft
   * has no café, so it stays only where the new membership can write.
   */
  function switchWorkspace(key: string) {
    const target = workspaces.find((entry) => entry.key === key) ?? null;
    switchTo(key);

    const menuId = routeMenuId(route);
    if (!menuId) return;
    const menuRestaurantId = menuRestaurantById.get(menuId);
    const belongsToTarget = menuRestaurantId
      ? menuRestaurantId === target?.restaurantId
      : workspaceCan(target, "menus.write");
    if (!belongsToTarget) navigate({ screen: "library" });
  }

  const routedMenuId = routeMenuId(route);
  /**
   * The café of the menu the URL names, and only while its document is the
   * open one: a document kept in memory while browsing the library must not
   * drag the context back.
   */
  const routedMenuRestaurantId =
    options.openDocId !== null && options.openDocId === routedMenuId
      ? (menuRestaurantById.get(options.openDocId) ?? null)
      : null;
  /**
   * The switcher follows the menu. A deep link can open a menu from the other
   * café — the account can read it — while the shell is still acting in the
   * café it was left in, which would leave the switcher and the screen
   * disagreeing. Select the menu's café instead, once that café is known and
   * the account actually holds it.
   */
  const followMenuCafe =
    signedIn &&
    !accountAccessPending &&
    accountKey !== null &&
    routedMenuRestaurantId !== null &&
    routedMenuRestaurantId !== active?.restaurantId &&
    workspaces.some((entry) => entry.restaurantId === routedMenuRestaurantId);

  useEffect(() => {
    if (!followMenuCafe || !routedMenuRestaurantId) return;
    // Deferred like the other account reads: never set state synchronously
    // while rendering the frame that decided to switch.
    void Promise.resolve().then(() => switchTo(routedMenuRestaurantId));
  }, [followMenuCafe, routedMenuRestaurantId, switchTo]);

  return { openMenu, newMenu, renameMenu, deleteMenu, switchWorkspace };
}

export type MenuLifecycleValue = ReturnType<typeof useMenuLifecycle>;

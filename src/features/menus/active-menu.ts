"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SaveState } from "@/components/menu-editor/menu-editor";
import {
  downloadTextFile,
  menuFilename,
  menuToCsv,
  parseImportedMenu,
  serializeMenu,
} from "@/features/menu/import-export";
import { suggestRestaurantName } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import {
  cacheMenu,
  deleteMenu,
  getMenu,
  listMenus,
  saveMenu,
  StorageError,
} from "@/features/menu/storage";
import {
  decideHeal,
  getDraftOrigin,
  listDraftOrigins,
  menuContentHash,
  refreshDraftSync,
  stampDraftOrigin,
  type DraftOrigin,
} from "@/features/menus/draft-origins";
import { useLibrary } from "@/features/menus/library-context";
import { decideMenuMembership } from "@/features/menus/membership";
import { forgetPendingNewMenu, isPendingNewMenu } from "@/features/menus/routed-doc";
import {
  createServerMenu,
  fetchServerMenu,
  SyncError,
  updateServerMenu,
  type ServerMenu,
} from "@/features/menus/sync";
import { useNavigation } from "@/features/navigation/navigation-context";
import { accessCan, isPublishedOnlyAccess, type MenuAccess } from "@/features/tenancy/access";
import { ensureFirstRestaurant } from "@/features/tenancy/first-restaurant";
import { useWorkspace } from "@/features/tenancy/workspace-context";

/**
 * The open menu: the one document the editor holds, the status of its save,
 * the account revision it was synced at, and the conflict that stops pushing
 * until the owner chooses. It is the only writer of a menu document — the
 * autosave, the conflict's two answers, the imports that file a new menu — so
 * no screen can save behind another one's back.
 *
 * It also files menus, because its own autosave is what creates them: the
 * café a new menu lands in, whether this membership may file at all, and the
 * signed-out prune that keeps this browser to one draft. Nothing is invented
 * behind anyone's back — a staff shift with no café it may write in files
 * nothing and says so.
 */
export type ActiveMenuOptions = {
  /** Whether a failed filing means this membership may not file menus. */
  cannotFileMenus(): boolean;
  /** The open document changed: the shell's per-menu answers follow it. */
  onOpenDoc(menuId: string): void;
};

/** Save status stays one word; `detail` says where the save went. */
function savedState(detail: string): SaveState {
  return { kind: "saved", message: "Saved", detail };
}

/** Content equality ignoring the save stamp (same rule the sync uses). */
function sameMenuContent(a: MenuDocument, b: MenuDocument): boolean {
  return JSON.stringify({ ...a, updatedAt: "" }) === JSON.stringify({ ...b, updatedAt: "" });
}

export function useActiveMenu(options: ActiveMenuOptions) {
  const { signedIn, accountKey, active, can, owned, restaurants, addRestaurant } = useWorkspace();
  const {
    storageDownRef,
    serverIdsRef,
    menuAccessRef,
    accountMenusSettledRef,
    accountMenusReadFailedRef,
    refreshLibrary,
    setMenuAccessFor,
    addServerId,
    removeServerId,
    rememberMenuCafe,
  } = useLibrary();
  const { navigate } = useNavigation();

  /** The café this editor files into, and whether it may file there at all. */
  const activeRestaurantId = active?.restaurantId ?? null;
  const signedInCanWrite = signedIn && can("menus.write");

  /** Session answers for async work that finishes after an await. */
  const signedInRef = useRef(signedIn);
  const accountKeyRef = useRef<string | null>(accountKey);
  useEffect(() => {
    signedInRef.current = signedIn;
    accountKeyRef.current = accountKey;
  }, [signedIn, accountKey]);

  // The one open document. The library itself lives in its own provider.
  const [activeDoc, setActiveDoc] = useState<MenuDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(
    savedState("Saved in this browser. Sign in to use this menu on other devices.")
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);

  const docRef = useRef<MenuDocument | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The server updatedAt the open menu was last synced at; null = don't push. */
  const serverBaseRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState<{ serverUpdatedAt: string | null } | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const conflictRef = useRef<{ serverUpdatedAt: string | null } | null>(null);

  /** The document the editor holds right now, read at call time. */
  const getOpenDoc = useCallback(() => docRef.current, []);
  const getOpenDocId = useCallback(() => docRef.current?.id ?? null, []);

  /**
   * The editor's photo URL. Stable, so the route opener can list it as a
   * dependency; the previous URL is released as it is replaced.
   */
  const setEditorImage = useCallback((url: string | null) => {
    setEditorImageUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  }, []);

  /**
   * The live photo URL, for the unmount revoke only: the setter already
   * releases the previous one, so a mirror written from an effect is enough
   * and nothing has to be read during render.
   */
  const imageUrlRef = useRef<string | null>(null);
  useEffect(() => {
    imageUrlRef.current = editorImageUrl;
  }, [editorImageUrl]);
  useEffect(() => {
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, []);

  /**
   * Push interrupted work from closed menus after a same-account return.
   * Only rows stamped to this account whose server revision is untouched
   * are pushed; anything diverged on both sides waits for the next open,
   * which raises the explicit conflict choice instead. Best-effort: every
   * failure mode leaves the browser copy alone for the offer/manual path.
   */
  async function healStampedDrafts() {
    const actor = accountKeyRef.current;
    if (!signedInRef.current || !actor) return;
    let origins: DraftOrigin[];
    try {
      origins = await listDraftOrigins();
    } catch {
      return;
    }
    let healedAny = false;
    for (const origin of origins.filter((item) => item.accountId === actor)) {
      if (docRef.current?.id === origin.menuId) continue;
      if (!accessCan(menuAccessRef.current.get(origin.menuId), "menus.write")) continue;
      try {
        const local = await getMenu(origin.menuId);
        const server = await fetchServerMenu(origin.menuId);
        const healedLocalHash = menuContentHash(local);
        if (sameMenuContent(server.doc, local)) {
          await refreshDraftSync(origin.menuId, actor, server.updatedAt, healedLocalHash);
          continue;
        }
        const decision = decideHeal({
          contentEqual: false,
          localUpdatedAt: local.updatedAt,
          lastSyncedUpdatedAt: origin.lastSyncedUpdatedAt,
          serverUpdatedAt: server.updatedAt,
          localHash: healedLocalHash,
          serverHash: menuContentHash(server.doc),
          lastSyncedHash: origin.lastSyncedHash ?? "",
        });
        if (decision !== "push") continue;
        const pushed = await updateServerMenu(local.id, local, server.updatedAt);
        await refreshDraftSync(local.id, actor, pushed.updatedAt, healedLocalHash);
        healedAny = true;
      } catch {
        // Never on the server, unreachable, or unreadable: the offer/manual
        // path or the next open handles it. Never throw from the heal.
        continue;
      }
    }
    if (healedAny) await refreshLibrary();
  }

  // --- Filing a menu ------------------------------------------------------

  /**
   * Single offline menu invariant: after a signed-out save, any other rows
   * are superseded — their replacement was confirmed where the flow began.
   * Best-effort: a failed prune leaves the extra row for the next save.
   */
  async function pruneSignedOutOthers(keepId: string) {
    if (signedInRef.current) return;
    try {
      const all = await listMenus();
      await Promise.all(
        all
          .filter((menu) => menu.id !== keepId)
          .map((menu) => deleteMenu(menu.id).catch(() => undefined))
      );
    } catch {
      // The next save retries; the extra row stays visible meanwhile.
    }
  }

  /**
   * Server-only creation (signed-in): a new menu is a cloud copy, never a
   * browser-only draft. Prefers the café the editor acts in when it may file
   * there, else the owner's first café; a brand-new account gets its café
   * provisioned from the menu title instead of a local draft (publishing can
   * no longer be the first server write). Staff-only contexts return null —
   * there is no café the caller may file in, and nothing is invented behind
   * anyone's back.
   */
  async function ensureServerTarget(menuTitle: string): Promise<string | null> {
    if (!signedInRef.current || !accountKeyRef.current) return null;
    if (activeRestaurantId && signedInCanWrite) return activeRestaurantId;
    if (owned.length > 0 && owned[0]) {
      return owned[0].id;
    }
    if ((restaurants?.length ?? 0) > 0) return null;
    try {
      // The account's first café is one decision shared with the draft claims:
      // an autosave landing while the sign-in claim is also creating one used
      // to mean two cafés on a brand-new account.
      const created = await ensureFirstRestaurant(
        accountKeyRef.current,
        suggestRestaurantName([menuTitle]) ?? "My restaurant"
      );
      addRestaurant(created);
      return created.id;
    } catch {
      return null;
    }
  }

  /**
   * File a fresh server menu as the local cache: same id, server clock,
   * stamped to this account so sign-out hides it like any account copy.
   */
  async function cacheServerDraft(server: ServerMenu): Promise<MenuDocument> {
    const cached = storageDownRef.current ? server.doc : await cacheMenu(server.doc);
    const actor = accountKeyRef.current;
    if (actor) await refreshDraftSync(cached.id, actor, server.updatedAt, menuContentHash(cached));
    addServerId(cached.id);
    setMenuAccessFor(cached.id, server.access);
    rememberMenuCafe(cached.id, server.restaurantId);
    return cached;
  }

  // --- Autosave -----------------------------------------------------------

  async function doSave() {
    const doc = docRef.current;
    if (!doc || storageDownRef.current) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedRef.current) {
      setSaveState(storageSaveState(doc.id));
      return;
    }
    // Server-only while signed in: the first change to a pending new menu
    // creates the cloud copy, so a rename-and-return is already on the
    // account. No local fallback — the error stays visible and the next
    // change retries, with the edits kept in memory meanwhile.
    if (isPendingNewMenu(doc.id) && signedInRef.current) {
      const pendingTarget = await ensureServerTarget(doc.title);
      if (!pendingTarget) {
        setSaveState({
          kind: "error",
          message: "Couldn't reach your account — edits are kept, and the next change retries.",
        });
        return;
      }
      try {
        const created = await createServerMenu(pendingTarget, doc);
        const cached = await cacheServerDraft(created);
        forgetPendingNewMenu(cached.id);
        lastSavedRef.current = JSON.stringify(cached);
        docRef.current = cached;
        setActiveDoc(cached);
        serverBaseRef.current = created.updatedAt;
        await refreshLibrary();
        setSaveState(savedState("Saved to your account."));
        return;
      } catch (error) {
        if (error instanceof SyncError && error.code === "exists") {
          try {
            const existing = await fetchServerMenu(doc.id);
            const cached = await cacheServerDraft(existing);
            forgetPendingNewMenu(cached.id);
            lastSavedRef.current = JSON.stringify(cached);
            docRef.current = cached;
            setActiveDoc(cached);
            serverBaseRef.current = existing.updatedAt;
            await refreshLibrary();
            setSaveState(savedState("Saved to your account."));
            return;
          } catch {
            // Fall through to the error below.
          }
        }
        setSaveState({
          kind: "error",
          message: "Couldn't save to your account — edits are kept, and the next change retries.",
        });
        return;
      }
    }
    try {
      const saved = await saveMenu(doc);
      lastSavedRef.current = JSON.stringify(saved);
      // Record whose work this is while the session is live. The stamp
      // keeps the last agreed revision when there is no new baseline, so a
      // later return can tell interrupted work from a stale cache.
      const actor = signedInRef.current ? accountKeyRef.current : null;
      if (actor && accessCan(menuAccessRef.current.get(saved.id), "menus.write")) {
        await stampDraftOrigin(saved.id, actor, serverBaseRef.current ?? "");
      }
      await refreshLibrary();
      if (!(await pushToAccount(saved))) {
        setSaveState(
          conflictRef.current
            ? {
                ...savedState("Saved in this browser."),
                kind: "error",
                message: "Changed on your other device — choose which version wins above.",
              }
            : savedState("Saved in this browser.")
        );
      }
    } catch (error) {
      setSaveState({
        kind: "error",
        message:
          error instanceof StorageError ? error.message : "Save failed — edits are kept in memory.",
      });
    }
  }

  /**
   * Push a just-saved document to the account (Step 8). Returns false when
   * the save stays in this browser — signed out, menu not added to the
   * account yet, or a conflict awaiting an explicit decision — in which
   * case the caller sets the status. Otherwise the save state is set here
   * and true is returned.
   */
  async function pushToAccount(saved: MenuDocument): Promise<boolean> {
    if (!signedInRef.current || serverBaseRef.current === null) return false;
    // Staff access is view-only: keep the local copy, never push an edit.
    if (!accessCan(menuAccessRef.current.get(saved.id), "menus.write")) return false;
    if (conflictRef.current) return false;
    setSaveState({ kind: "saving", message: "Saving to your account…" });
    try {
      const pushed = await updateServerMenu(saved.id, saved, serverBaseRef.current);
      serverBaseRef.current = pushed.updatedAt;
      const actor = accountKeyRef.current;
      if (actor) await refreshDraftSync(saved.id, actor, pushed.updatedAt, menuContentHash(saved));
      setSaveState(savedState("Saved to your account."));
      return true;
    } catch (error) {
      if (error instanceof SyncError && error.code === "conflict") {
        // Someone else wrote first. Keep the local edits, stop pushing, and
        // let the banner ask which version wins — never overwrite silently.
        conflictRef.current = { serverUpdatedAt: error.currentUpdatedAt };
        setConflict(conflictRef.current);
        setConflictError(null);
        setSaveState({
          kind: "error",
          message: "Changed on your other device — choose which version wins above.",
        });
        return true;
      }
      if (error instanceof SyncError && error.code === "unauthorized") {
        serverBaseRef.current = null;
        setSaveState(
          savedState("Saved in this browser — sign in again to save it to your account.")
        );
        return true;
      }
      if (error instanceof SyncError && error.code === "forbidden") {
        serverBaseRef.current = null;
        setSaveState(
          savedState("Saved in this browser — you don't have write access to this menu.")
        );
        return true;
      }
      if (error instanceof SyncError && error.code === "not_found") {
        serverBaseRef.current = null;
        removeServerId(saved.id);
        setSaveState(savedState("Saved in this browser — this menu is no longer in your account."));
        return true;
      }
      // Offline / server down: the browser copy is safe and retried next save.
      setSaveState(savedState("Saved in this browser — your account can't be reached right now."));
      return true;
    }
  }

  /**
   * Where this document's saves go, as far as the client can honestly say.
   * Before the account's list settles the answer is "checking", not "in this
   * browser": the latter is false for every account menu (003).
   */
  function storageSaveState(id: string): SaveState {
    // A menu that has never changed has never been saved: saying "Saved"
    // would promise a row the library does not have.
    if (isPendingNewMenu(id)) {
      return {
        kind: "saved",
        message: "Not saved yet",
        detail: signedInRef.current
          ? "Your first change saves it to your account."
          : "Your first change saves it in this browser.",
      };
    }
    if (serverBaseRef.current) return savedState("Saved to your account.");
    const membership = decideMenuMembership({
      signedIn: signedInRef.current,
      readSettled: accountMenusSettledRef.current === accountKeyRef.current,
      readFailed: accountMenusReadFailedRef.current === accountKeyRef.current,
      onServer: serverIdsRef.current.has(id),
    });
    if (membership === "account") return savedState("Saved to your account.");
    if (membership === "unknown") {
      return { kind: "checking", message: "Checking your account…" };
    }
    if (membership === "unreachable") {
      return savedState("Saved here — your account couldn't be checked.");
    }
    return savedState("Saved in this browser.");
  }

  async function flushSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await doSave();
  }

  /** Every editor change flows through here: update state + debounced save. */
  function handleDocChange(next: MenuDocument) {
    // The first change retires the pending marker: whatever happens next,
    // this menu is a real draft and resolves like one.
    forgetPendingNewMenu(next.id);
    setActiveDoc(next);
    docRef.current = next;
    if (storageDownRef.current) {
      setSaveState({
        kind: "error",
        message: "Storage unavailable — edits are kept in memory only.",
      });
      return;
    }
    setSaveState({ kind: "saving", message: "Saving…" });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void doSave(), 600);
  }

  async function openDoc(
    doc: MenuDocument,
    imageBlob: Blob | null,
    updateRoute = true,
    accessHint?: MenuAccess
  ) {
    // Publication and the other per-menu answers follow the open document.
    options.onOpenDoc(doc.id);
    // A caller that already knows the answer (a server route open, or a menu
    // created here) hands it over so the first frame is decided, not guessed.
    if (accessHint) setMenuAccessFor(doc.id, accessHint);
    docRef.current = doc;
    lastSavedRef.current = JSON.stringify(doc);
    setActiveDoc(doc);
    setSaveState(
      storageDownRef.current
        ? { kind: "error", message: "Storage unavailable — edits are kept in memory only." }
        : storageSaveState(doc.id)
    );
    setImportError(null);
    setEditorImage(imageBlob ? URL.createObjectURL(imageBlob) : null);
    if (updateRoute) navigate({ screen: "editor", menuId: doc.id, mode: "edit" });
    void syncWithAccount(doc);
  }

  /**
   * Reconcile a just-opened menu with the account (signed in only). The
   * account is authoritative: when it holds a different revision, adopt it
   * and keep IndexedDB in step as the cache. Menus that were never added to
   * the account stay in this browser — "Add to account" is the explicit path
   * for those.
   */
  async function syncWithAccount(localDoc: MenuDocument) {
    serverBaseRef.current = null;
    conflictRef.current = null;
    setConflict(null);
    setConflictError(null);
    if (!signedInRef.current) return;
    try {
      const serverMenu = await fetchServerMenu(localDoc.id);
      rememberMenuCafe(localDoc.id, serverMenu.restaurantId);
      const serverAccess = serverMenu.access;
      // A write-capable caller may be editable as soon as access is known. A
      // read-only caller waits for the server's document to replace whatever
      // this browser cached, so a stale draft is never painted as preview.
      const serverCanWrite = accessCan(serverAccess, "menus.write");
      if (serverCanWrite) setMenuAccessFor(localDoc.id, serverAccess);
      if (docRef.current?.id !== localDoc.id) return;
      const actor = signedInRef.current ? accountKeyRef.current : null;
      const staffOnly = !serverCanWrite;
      const origin = actor ? await getDraftOrigin(localDoc.id).catch(() => undefined) : undefined;
      if (origin && actor && origin.accountId !== actor) {
        // Another account's cached row on this device: never touch its
        // draft. The exception is a published menu the server just listed
        // for this read-only caller — that is the shared live snapshot, and
        // the next step replaces the cached draft with it.
        if (!isPublishedOnlyAccess(serverAccess)) {
          removeServerId(localDoc.id);
          setMenuAccessFor(localDoc.id, "none");
          setSaveState(savedState("Saved in this browser — not in your account."));
          return;
        }
      }
      const equal = sameMenuContent(serverMenu.doc, localDoc);
      const localHash = menuContentHash(localDoc);
      const decision = equal
        ? "none"
        : decideHeal({
            contentEqual: false,
            localUpdatedAt: localDoc.updatedAt,
            lastSyncedUpdatedAt: origin?.lastSyncedUpdatedAt ?? "",
            serverUpdatedAt: serverMenu.updatedAt,
            localHash,
            serverHash: menuContentHash(serverMenu.doc),
            lastSyncedHash: origin?.lastSyncedHash ?? "",
          });
      if (decision === "push" && actor && !staffOnly) {
        // Interrupted work (expired session, dropped connection) outranks an
        // untouched server revision: push it instead of adopting over it.
        try {
          const pushed = await updateServerMenu(localDoc.id, localDoc, serverMenu.updatedAt);
          if (docRef.current?.id !== localDoc.id) return;
          serverBaseRef.current = pushed.updatedAt;
          addServerId(localDoc.id);
          await refreshDraftSync(localDoc.id, actor, pushed.updatedAt, localHash);
          setSaveState(savedState("Saved to your account."));
          await refreshLibrary();
        } catch (pushError) {
          if (docRef.current?.id !== localDoc.id) return;
          if (pushError instanceof SyncError && pushError.code === "conflict") {
            conflictRef.current = { serverUpdatedAt: pushError.currentUpdatedAt };
            setConflict(conflictRef.current);
            setConflictError(null);
            setSaveState({
              kind: "error",
              message: "Changed on your other device — choose which version wins above.",
            });
          } else if (pushError instanceof SyncError && pushError.code === "forbidden") {
            serverBaseRef.current = null;
            setSaveState(
              savedState("Saved in this browser — you don't have write access to this menu.")
            );
          } else {
            setSaveState(
              savedState("Saved in this browser — your account can't be reached right now.")
            );
          }
        }
        return;
      }
      serverBaseRef.current = serverMenu.updatedAt;
      addServerId(localDoc.id);
      if (decision === "conflict") {
        // Both sides moved since the last agreement: an explicit choice,
        // never a silent adopt over unsynced work.
        setMenuAccessFor(localDoc.id, serverAccess);
        conflictRef.current = { serverUpdatedAt: serverMenu.updatedAt };
        setConflict(conflictRef.current);
        setConflictError(null);
        setSaveState({
          kind: "error",
          message: "Changed on your other device — choose which version wins above.",
        });
        return;
      }
      if (!equal) {
        let next: MenuDocument = serverMenu.doc;
        if (!storageDownRef.current) {
          next = await saveMenu(serverMenu.doc).catch(() => serverMenu.doc);
        }
        if (docRef.current?.id !== localDoc.id) return;
        docRef.current = next;
        lastSavedRef.current = JSON.stringify(next);
        setActiveDoc(next);
        if (!serverCanWrite) setMenuAccessFor(localDoc.id, serverAccess);
        if (actor && !staffOnly)
          await refreshDraftSync(localDoc.id, actor, serverMenu.updatedAt, menuContentHash(next));
        setSaveState(savedState("Showing the version from your account."));
        await refreshLibrary();
        return;
      }
      if (!serverCanWrite) setMenuAccessFor(localDoc.id, serverAccess);
      if (actor && !staffOnly)
        await refreshDraftSync(localDoc.id, actor, serverMenu.updatedAt, localHash);
      setSaveState(savedState("Saved to your account."));
    } catch (error) {
      if (docRef.current?.id !== localDoc.id) return;
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(localDoc.id);
        // The server has no row: a stamp for this account, or the local answer
        // already recorded, means a browser-only draft. Anything else is a
        // cached menu this account may not read, so its content stays shut
        // instead of rendering a stale draft.
        const originNow = await getDraftOrigin(localDoc.id).catch(() => undefined);
        const localDraft =
          menuAccessRef.current.get(localDoc.id) === "local" ||
          (originNow != null && originNow.accountId === accountKeyRef.current);
        setMenuAccessFor(localDoc.id, localDraft ? "local" : "none");
        // The server finding nothing is expected for a menu that was never
        // saved — it is not news, so the status keeps saying so.
        if (isPendingNewMenu(localDoc.id)) {
          setSaveState({
            kind: "saved",
            message: "Not saved yet",
            detail: "Your first change saves it in this browser.",
          });
          return;
        }
        setSaveState(
          localDraft
            ? savedState("Saved in this browser — not in your account yet.")
            : savedState("This menu isn't available to your account.")
        );
        return;
      }
      if (error instanceof SyncError && error.code === "unauthorized") {
        setMenuAccessFor(localDoc.id, "none");
        setSaveState(
          savedState("Saved in this browser — sign in again to save it to your account.")
        );
        return;
      }
      setSaveState(savedState("Saved in this browser — your account can't be reached right now."));
    }
  }

  /** Conflict action: adopt the account's revision, discarding local edits. */
  async function handleLoadServerVersion() {
    const doc = docRef.current;
    if (!doc) return;
    setConflictError(null);
    try {
      const serverMenu = await fetchServerMenu(doc.id);
      setMenuAccessFor(doc.id, serverMenu.access);
      let next: MenuDocument = serverMenu.doc;
      if (!storageDownRef.current) {
        next = await saveMenu(serverMenu.doc).catch(() => serverMenu.doc);
      }
      if (docRef.current?.id !== doc.id) return;
      docRef.current = next;
      lastSavedRef.current = JSON.stringify(next);
      setActiveDoc(next);
      serverBaseRef.current = serverMenu.updatedAt;
      conflictRef.current = null;
      setConflict(null);
      const loadActor = accountKeyRef.current;
      if (loadActor && accessCan(serverMenu.access, "menus.write")) {
        await refreshDraftSync(doc.id, loadActor, serverMenu.updatedAt, menuContentHash(next));
      }
      setSaveState(savedState("Showing the version from your account."));
      await refreshLibrary();
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        conflictRef.current = { serverUpdatedAt: null };
        setConflict({ serverUpdatedAt: null });
        setConflictError("This menu is no longer in your account — keeping your version is safe.");
        return;
      }
      setConflictError(
        "Could not load the version from your account. Check your connection and try again."
      );
    }
  }

  /** Conflict action: push the local revision over the account's, explicitly. */
  async function handleKeepMyVersion() {
    const doc = docRef.current;
    const expected = conflict?.serverUpdatedAt ?? null;
    if (!doc || expected === null) return;
    setConflictError(null);
    try {
      const pushed = await updateServerMenu(doc.id, doc, expected);
      serverBaseRef.current = pushed.updatedAt;
      const keepActor = accountKeyRef.current;
      if (keepActor)
        await refreshDraftSync(doc.id, keepActor, pushed.updatedAt, menuContentHash(doc));
      conflictRef.current = null;
      setConflict(null);
      setSaveState(savedState("Saved to your account."));
    } catch (error) {
      if (error instanceof SyncError && error.code === "conflict") {
        conflictRef.current = { serverUpdatedAt: error.currentUpdatedAt };
        setConflict(conflictRef.current);
        setConflictError("It changed again while you were deciding — review and choose once more.");
        return;
      }
      if (error instanceof SyncError && error.code === "not_found") {
        conflictRef.current = { serverUpdatedAt: null };
        setConflict({ serverUpdatedAt: null });
        setConflictError(
          "This menu is no longer in your account — your version stays saved in this browser."
        );
        return;
      }
      setConflictError("Could not save to your account. Your edits are safe in this browser.");
    }
  }

  // --- Import / export ----------------------------------------------------

  function handleExportJson() {
    const doc = docRef.current;
    if (!doc) return;
    try {
      downloadTextFile(menuFilename(doc.title, "json"), serializeMenu(doc), "application/json");
    } catch {
      setImportError("Export failed: the menu data is invalid.");
    }
  }

  function handleExportCsv() {
    const doc = docRef.current;
    if (!doc) return;
    try {
      downloadTextFile(menuFilename(doc.title, "csv"), menuToCsv(doc), "text/csv");
    } catch {
      setImportError("Export failed: the menu data is invalid.");
    }
  }

  async function importFile(file: File) {
    setImportError(null);
    try {
      const doc = parseImportedMenu(await file.text());
      // Server-only while signed in: an import lands straight on the
      // account. Staff-only sign-ins have no writable café, so the import
      // is refused instead of stacking a browser-only draft.
      if (signedInRef.current) {
        if (storageDownRef.current) {
          setImportError("Browser storage is unavailable, so the menu can't be cached. Try again.");
          return;
        }
        const importTarget = await ensureServerTarget(doc.title);
        if (!importTarget) {
          setImportError(
            options.cannotFileMenus()
              ? "Only the restaurant owner can add menus — ask the owner to import this file."
              : "Couldn't reach your account. Check your connection and try again."
          );
          return;
        }
        try {
          const created = await createServerMenu(importTarget, doc);
          const cached = await cacheServerDraft(created);
          await refreshLibrary();
          await openDoc(cached, null, true, created.access);
          return;
        } catch (error) {
          if (error instanceof SyncError && error.code === "exists") {
            const existing = await fetchServerMenu(doc.id);
            const cached = await cacheServerDraft(existing);
            await refreshLibrary();
            await openDoc(cached, null, true, existing.access);
            return;
          }
          throw error;
        }
      }
      // Single offline menu: the prune after saving supersedes the old draft.
      const saved = storageDownRef.current ? doc : await saveMenu(doc);
      await pruneSignedOutOthers(saved.id);
      if (!storageDownRef.current) await refreshLibrary();
      await openDoc(saved, null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import that file.");
    }
  }

  // --- Doors the shell's neighbours use -----------------------------------

  /**
   * The claim took the open row over: pin the editor to the agreed revision so
   * the next save stays on the account instead of forking the one just made.
   */
  async function onClaimedOpenDoc(menuId: string) {
    const server = await fetchServerMenu(menuId);
    const actor = accountKeyRef.current;
    if (docRef.current?.id !== menuId || !actor) return;
    serverBaseRef.current = server.updatedAt;
    await refreshDraftSync(menuId, actor, server.updatedAt, menuContentHash(server.doc));
    await refreshLibrary();
    setSaveState(savedState("Saved to your account."));
  }

  /**
   * The server agreed on a revision for the open menu (the publish wizard's
   * snapshot, a rename pushed from the library): the next save continues from
   * there instead of forking it.
   */
  function onServerRevision(menuId: string, serverUpdatedAt: string) {
    if (docRef.current?.id === menuId) serverBaseRef.current = serverUpdatedAt;
  }

  /** The agreed revision to stamp a library rename with, when `id` is open. */
  function openBaseline(id: string): string {
    return docRef.current?.id === id ? (serverBaseRef.current ?? "") : "";
  }

  /** A rename made in the library lands on the open document too. */
  function onMenuRenamed(renamed: MenuDocument) {
    if (docRef.current?.id !== renamed.id) return;
    docRef.current = renamed;
    lastSavedRef.current = JSON.stringify(renamed);
    setActiveDoc(renamed);
  }

  /** A deleted menu cannot stay open: forget it, image URL and all. */
  function forgetOpenDoc(id: string) {
    if (docRef.current?.id !== id) return;
    docRef.current = null;
    lastSavedRef.current = null;
    serverBaseRef.current = null;
    conflictRef.current = null;
    setConflict(null);
    setActiveDoc(null);
    setEditorImage(null);
  }

  /** Leaving the editor for the library releases the photo, not the document. */
  function clearImage() {
    setEditorImage(null);
  }

  /**
   * Sign-out is a privacy boundary: release the document before it is saved,
   * so pending account work (sync, publication, the route opener) bails once
   * `docRef` is null. The direct save still keeps the latest local edits.
   */
  function releaseOpenDoc() {
    const doc = docRef.current;
    if (!doc) return;
    docRef.current = null;
    lastSavedRef.current = null;
    serverBaseRef.current = null;
    conflictRef.current = null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // A menu with no changes was never created: persisting it here would mint
    // exactly the phantom the transient flow avoids.
    if (!storageDownRef.current && JSON.stringify(doc) !== lastSavedRef.current) {
      void saveMenu(doc).catch(() => undefined);
    }
  }

  /** The session ended: no document, no photo, no conflict to answer. */
  function resetActiveMenu() {
    setActiveDoc(null);
    setEditorImage(null);
    setConflict(null);
    setConflictError(null);
  }

  /**
   * An account just appeared: reconcile the document that was already open,
   * and name it so the caller can refresh the answers that follow a menu.
   */
  function resyncOpenDoc(): string | null {
    const doc = docRef.current;
    if (!doc) return null;
    if (serverBaseRef.current === null && !conflictRef.current) void syncWithAccount(doc);
    return doc.id;
  }

  return {
    doc: activeDoc,
    saveState,
    conflict,
    conflictError,
    imageUrl: editorImageUrl,
    importError,
    getOpenDoc,
    getOpenDocId,
    openBaseline,
    onServerRevision,
    onClaimedOpenDoc,
    onMenuRenamed,
    openDoc,
    changeDoc: handleDocChange,
    flushSave,
    ensureServerTarget,
    cacheServerDraft,
    pruneSignedOutOthers,
    healStampedDrafts,
    handleLoadServerVersion,
    handleKeepMyVersion,
    handleExportJson,
    handleExportCsv,
    importFile,
    forgetOpenDoc,
    clearImage,
    showImage: setEditorImage,
    releaseOpenDoc,
    resetActiveMenu,
    resyncOpenDoc,
  };
}

export type ActiveMenuValue = ReturnType<typeof useActiveMenu>;

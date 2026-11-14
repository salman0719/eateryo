"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { AssistantPage } from "@/components/pages/assistant-page";
import { CapturePage } from "@/components/pages/capture-page";
import { MenusPage } from "@/components/pages/menus-page";
import { OrdersPage } from "@/components/pages/orders-page";
import { SettingsPage } from "@/components/pages/settings-page";
import { TablesPage } from "@/components/pages/tables-page";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { HeightReveal } from "@/components/ui/height-reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { ConflictBanner } from "@/components/menu-editor/conflict-banner";
import { MissingDraftCard } from "@/components/menu-editor/missing-draft-card";
import { MenuEditor } from "@/components/menu-editor/menu-editor";
import { PublishWizard } from "@/components/menu-editor/publish-wizard";
import {
  createMenuDocument,
  defaultNewMenuTitle,
  suggestRestaurantName,
} from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import {
  cacheMenu,
  deleteMenu,
  getImage,
  getMenu,
  listMenus,
  renameMenu,
  saveImage,
  saveMenu,
  StorageError,
  type MenuSummary,
} from "@/features/menu/storage";
import {
  createServerMenu,
  deleteServerMenu,
  fetchServerMenu,
  SyncError,
  type ServerMenu,
  updateServerMenu,
} from "@/features/menus/sync";
import { useRouter } from "next/navigation";

import { rememberPublishJourney } from "@/features/publishing/wizard-state";
import { saveDirectSignInIntent } from "@/features/menus/direct-sign-in";
import { authClient } from "@/lib/auth-client";
import { ExtractClientError } from "@/lib/extract-client";
import {
  availableSections,
  moreSheetRows,
  phoneTabs,
  routeMenuId,
  shellColumnVisible,
  signOutLandingRoute,
  unresolvableMenuMessage,
  type AppRoute,
  type AppScreen,
  type EditorMode,
} from "@/features/navigation/routes";
import { useFeatureFlags } from "@/features/flags/client";
import { fetchLaunchStatus } from "@/features/launch/client";
import { cardsPrintedOnThisDevice, launchProgress } from "@/features/launch/progress";
import {
  accessCan,
  accessIsStaff,
  isPublishedOnlyAccess,
  type MenuAccess,
} from "@/features/tenancy/access";
import { workspaceCan } from "@/features/tenancy/workspace";
import { WorkspaceProvider, useWorkspace } from "@/features/tenancy/workspace-context";
import { LibraryProvider, useLibrary } from "@/features/menus/library-context";
import { useActiveMenu } from "@/features/menus/active-menu";
import { useDraftClaims } from "@/features/menus/draft-claims";
import { useCapture } from "@/features/capture/use-capture";
import { usePublication } from "@/features/publishing/use-publication";
import { NavigationProvider, useNavigation } from "@/features/navigation/navigation-context";
import { createRestaurant } from "@/features/tenancy/client";
import {
  clearDraftOrigin,
  collectSignOutDissolveIds,
  getDraftOrigin,
  listDraftOrigins,
  menuContentHash,
  refreshDraftSync,
  stampDraftOrigin,
  unstampedIds,
  visibleMenuIds,
} from "@/features/menus/draft-origins";
import { resumeBannerReady } from "@/features/menus/claim-local-drafts";
import {
  decideMenuOpen,
  isSessionGateMessage,
  menuOpenBlockedMessage,
  type SessionState,
} from "@/features/session/state";
import {
  decideMenuMembership,
  membershipFlag,
  type MenuMembership,
} from "@/features/menus/membership";

import {
  docForRoutedMenu,
  forgetPendingNewMenu,
  isPendingNewMenu,
  rememberPendingNewMenu,
} from "@/features/menus/routed-doc";

type Phase = "upload" | "ready" | "extracting" | "done";

function stepIndex(phase: Phase, hasResult: boolean): number {
  if (hasResult || phase === "done") return 2;
  if (phase === "ready" || phase === "extracting") return 1;
  return 0;
}

/**
 * The whole signed-in/out app shell (capture → library → editor → …).
 * Every screen URL has its own route file that hands us its parsed route,
 * so a hard load server-renders the right screen instead of flashing the
 * capture screen first; after hydration `syncFromLocation` keeps `route`
 * in step with the History API.
 */
export function HomeScreen({ initialRoute }: { initialRoute: AppRoute }) {
  // The account and the acting membership live one level up, so every screen
  // (this shell included) asks about the same café. The screen itself belongs
  // to the navigation provider, so every screen can read it without the shell.
  return (
    <WorkspaceProvider>
      <NavigationProvider initialRoute={initialRoute}>
        <LibraryProvider>
          <HomeShell />
        </LibraryProvider>
      </NavigationProvider>
    </WorkspaceProvider>
  );
}

function HomeShell() {
  // The URL is the source of truth for the main screen and selected menu; the
  // provider owns that state and the history writes (see navigation-context).
  const {
    route,
    navigate,
    ready: navigationReady,
    missingPublishMenuId,
    markMissingPublish,
    registerSaveFlush,
  } = useNavigation();
  const { confirm, dialog } = useConfirm();
  // Everything the account has answered about the library lives one level up,
  // so every screen reads the same list and the same membership markers.
  const {
    menus,
    originList,
    libraryLoading,
    libraryError,
    storageDown,
    storageDownRef,
    serverIds,
    serverIdsRef,
    menuAccess,
    menuAccessRef,
    menuRestaurantById,
    serverMenusFor,
    serverMenusReadFor,
    serverMenusReadFailedFor,
    accountMenusSettledRef,
    refreshLibrary,
    reportLibraryError,
    mergeAccountMenus,
    retryAccountCheck,
    resetAccountAnswer,
    setMenuAccessFor,
    addServerId,
    removeServerId,
    rememberMenuCafe,
  } = useLibrary();
  const screen: AppScreen = route.screen === "item" ? "editor" : route.screen;
  const selectedItemId = route.screen === "item" ? route.itemId : null;
  /** R0 phone nav: the More sheet (Tables · Assistant · Settings). */
  const [moreOpen, setMoreOpen] = useState(false);
  /**
   * The launch checklist's progress for the sidebar row. `accountKey` travels
   * with it so a previous account's count can never show for this one before
   * its own read lands; nothing is shown while the read is pending or failed.
   */
  const [launchChecklist, setLaunchChecklist] = useState<{
    accountKey: string;
    restaurantId: string;
    done: number;
    total: number;
    complete: boolean;
  } | null>(null);
  // Which editor surface the URL asks for (edit, reorder, preview);
  // an item deep link is always the edit workspace.
  const editorMode: EditorMode = route.screen === "editor" ? route.mode : "edit";
  const openedRouteMenuRef = useRef<string | null>(null);
  /** Previous session state, so only a real sign-out (not a first load) clears. */
  const wasSignedInRef = useRef(false);
  /** The account that was signed in, so sign-out can drop its synced rows. */
  const prevAccountKeyRef = useRef<string | null>(null);

  const router = useRouter();

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // The account read and the acting membership belong to the provider above
  // the shell: one read for every screen. What the shell may do is the active
  // membership's answer, never a union across cafés.
  const workspace = useWorkspace();
  const accountCan = workspace.can;
  const signedIn = workspace.signedIn;
  const accountKey = workspace.accountKey;
  const sessionState = workspace.sessionState;
  const sessionPending = workspace.sessionPending;
  const sessionCheckGaveUp = workspace.sessionCheckGaveUp;
  const userId = workspace.userId;
  const email = workspace.email;
  const activeWorkspace = workspace.active;
  const workspaces = workspace.workspaces;
  const restaurantList = workspace.restaurants;
  const ownedRestaurantsForAccount = workspace.owned;
  const accountAccessPending = signedIn && workspace.pending;
  const restaurantsLoading = signedIn && workspace.pending;
  const switchWorkspace = workspace.switchTo;
  /** The café the shell acts in, from the provider above the shell. */
  const activeRestaurantId = activeWorkspace?.restaurantId ?? null;
  /** Whether this membership may file new menus into the acting café. */
  const signedInCanWrite = signedIn && accountCan("menus.write");
  // The capture document — pages, extraction, the result under review and its
  // draft. It ends where the menu begins; this screen keeps the menu.
  const {
    pages,
    fileError,
    phase,
    extracted,
    resultDoc,
    extractProgress,
    draftSave,
    initialReviewCount,
    demoDoc,
    source,
    extractError,
    result,
    setExtractError,
    applySelection,
    selectFiles,
    addPages,
    replacePageAt,
    removePage,
    clearCapture,
    handleExtract,
    handleDemo,
    handleResolveResultItem,
    handleUpdateResultPrice,
    handleResolveAllResultItems,
    handleRenameResultTitle,
    resumeDraft,
    documentForSave,
    draftDocId,
  } = useCapture({
    confirmDiscard,
    ensureServerTarget: (menuTitle: string) =>
      ensureServerTarget(menuTitle, activeRestaurantId, signedInCanWrite),
    cacheServerDraft,
    pruneSignedOutOthers,
    revealResult: scrollToResult,
    reportError: reportLibraryError,
  });
  /**
   * The ownership wall's sentence is only true while nobody is known, so it is
   * derived away the moment a session settles signed in — never cleared by an
   * effect that could render it for a frame first (015). Derived, not deleted:
   * the stored message is what a later genuine sign-out has to say.
   */
  const visibleLibraryError = signedIn && isSessionGateMessage(libraryError) ? null : libraryError;
  // Server-evaluated release decisions (A4). Both assistant flags default
  // off, so the tab and panel appear only for a released account or a
  // preview link; the loading state below avoids flashing “unavailable” while
  // the server answers.
  const { flags: featureFlags, loading: featureFlagsLoading } = useFeatureFlags(userId);

  const signedInRef = useRef(false);
  /** Session state at decision time (a closure may outlive the render). */
  const sessionStateRef = useRef<SessionState>("unknown");
  /** Current account id for async work (closures may outlive the render). */
  const accountKeyRef = useRef<string | null>(null);
  // The one open document — its autosave, flush, conflict, photo and the files
  // it imports — is its own unit. It files a menu through the shell's menu
  // lifecycle doors, so the café a menu lands in stays decided here.
  const {
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
    healStampedDrafts,
    handleLoadServerVersion,
    handleKeepMyVersion,
    handleExportJson,
    handleExportCsv,
    importFile,
    forgetOpenDoc,
    clearImage,
    showImage,
    releaseOpenDoc,
    resetActiveMenu,
    resyncOpenDoc,
  } = useActiveMenu({
    fileMenu: (menuTitle) => ensureServerTarget(menuTitle, activeRestaurantId, signedInCanWrite),
    cacheServerDraft,
    pruneSignedOutOthers,
    cannotFileMenus,
    onOpenDoc,
  });
  /**
   * Where the open menu is saved. `null` while the account read is still
   * pending, so nothing claims "this browser only" on a guess (001, 003).
   */
  const activeMenuMembership: MenuMembership | null = activeDoc
    ? decideMenuMembership({
        signedIn,
        readSettled: serverMenusReadFor === accountKey,
        readFailed: serverMenusReadFailedFor === accountKey,
        onServer: serverIds.has(activeDoc.id),
      })
    : null;
  const activeMenuOnServer = activeMenuMembership ? membershipFlag(activeMenuMembership) : null;
  /**
   * A failed read is not a wait: the editor says the account couldn't be
   * checked, and does not offer the café-creating flow on a guess (016).
   */
  const activeMenuAccountCheckFailed = activeMenuMembership === "unreachable";
  // Draft claims: every browser draft is adopted on sign-in, silently. The
  // unit decides where they land and settles the gate; the editor stays here
  // and is reached through two named doors.
  const {
    claimError,
    setClaimError,
    claimGate,
    canFileBrowserDrafts,
    claimSurfaceQuiet,
    dissolveBrowserMenu,
    partitionRealMenus,
    resetClaimState,
  } = useDraftClaims({
    getOpenDocId,
    onClaimedOpenDoc,
    routeMenuId: routeMenuId(route),
    screen: route.screen,
  });
  // Publication follows the open document: whether it is live, what diners see
  // now, and the actions that change it. It reaches the editor through two
  // doors so neither side mirrors the other.
  const {
    publication,
    publicationMenuId,
    publicationLoaded,
    publishBusy,
    publishError,
    liveDoc,
    liveDocMenuId,
    liveDocState,
    resetPublication,
    refreshPublication,
    handlePublish,
    handleUnpublish,
    handleWizardPublished,
  } = usePublication({
    getOpenDoc,
    flushSave,
    onServerRevision,
    onPublishedMenu: (menuId) => {
      if (menuId === draftDocId() || menuId === demoDoc?.id) clearCapture();
    },
  });

  /**
   * The open document changed: publication belongs to one menu, so it retires
   * the answer it had and asks for this one's. The unit announces the open
   * document rather than importing a unit that sits below it.
   */
  function onOpenDoc(menuId: string) {
    resetPublication();
    void refreshPublication(menuId);
  }

  /**
   * Session state of the "Continue getting your link" resume banner (Q7).
   * `null` means *not confirmed yet*: the banner's inputs are read
   * asynchronously (IndexedDB, the session, the account's server
   * inventory), so nothing may show on the optimistic first frame. An
   * effect below confirms it to `false` once those inputs settle; `true`
   * is only ever written by Dismiss.
   */
  const [resumeDismissed, setResumeDismissed] = useState<boolean | null>(null);

  /**
   * Café-keyed read: the library is one café's list, so a different membership
   * starts from a different read, and an account with no café settles empty
   * instead of waiting forever. Ids and access answers from the previous café
   * do not describe this one, so they are dropped before the new read.
   */

  /**
   * Whether a refused filing is about permission rather than reach: a staff
   * shift has no café it may add menus to, so the import can say who can.
   */
  function cannotFileMenus(): boolean {
    return canFileBrowserDrafts === false && (restaurantList?.length ?? 0) > 0;
  }

  // --- Library actions ----------------------------------------------------

  function handleOpenMenu(id: string) {
    reportLibraryError(null);
    navigate({ screen: "editor", menuId: id, mode: "edit" });
  }

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

  async function handleNewMenu(suggestedTitle?: string) {
    reportLibraryError(null);
    if (!signedInRef.current) {
      // Replacement, not accumulation: the old offline draft goes away now
      // so the new blank slate is the browser's one menu. No confirmation —
      // starting over is the whole point of this button.
      try {
        const all = await listMenus();
        await Promise.all(all.map((menu) => deleteMenu(menu.id).catch(() => undefined)));
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
    await openDoc(doc, null, true, "local");
  }

  async function handleRenameMenu(id: string, title: string) {
    const access = menuAccessRef.current.get(id);
    if (signedInRef.current && access !== "local" && !accessCan(access, "menus.write")) {
      reportLibraryError("Only someone with menu access can rename this menu.");
      return;
    }
    try {
      const renamed = await renameMenu(id, title);
      const renameActor = signedInRef.current ? accountKeyRef.current : null;
      if (renameActor && accessCan(menuAccessRef.current.get(id), "menus.write")) {
        // Keep the existing baseline when this menu is not open: the
        // editor's baseline belongs to another document.
        await stampDraftOrigin(id, renameActor, openBaseline(id));
      }
      if (signedInRef.current && serverIdsRef.current.has(id)) {
        await pushRenameToAccount(renamed);
      }
      await refreshLibrary();
      onMenuRenamed(renamed);
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
        onServerRevision(renamed.id, pushed.updatedAt);
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

  /**
   * The plain "Sign in" buttons (brand row, sidebar account, library gate,
   * publish panel): signed out with a real local menu, the owner chooses
   * before leaving. Add → the ids attach on login; delete → they are wiped
   * on login; staying is always one Escape away. Sample rows are
   * disregarded without asking, stamped rows stay for the claim without
   * asking; without any anonymous menu the link navigates immediately.
   */
  async function requestDirectSignIn() {
    if (signedInRef.current) {
      router.push("/sign-in");
      return;
    }
    let existing: MenuSummary[] = [];
    try {
      existing = await listMenus();
    } catch {
      existing = [];
    }
    const titles = new Map(existing.map((menu) => [menu.id, menu.title] as [string, string]));
    const { real, demo } = await partitionRealMenus(existing.map((menu) => menu.id));
    // Stamped rows belong to an account — the claim moves them, the heal
    // triages them — so the choice names only anonymous drafts and never
    // asks about a menu that is already on one.
    const askable = unstampedIds(real, await listDraftOrigins().catch(() => []));
    const realTitles = new Map(
      real.map((id) => [id, titles.get(id)] as [string, string | undefined])
    );
    if (askable.length === 0) {
      // Only sample rows, stamped rows, or nothing at all: no
      // confirmation, the demo data is simply disregarded on the way in
      // and stamped rows stay for the claim.
      for (const id of demo) await dissolveBrowserMenu(id);
      router.push("/sign-in");
      return;
    }
    const firstTitle = realTitles.get(askable[0]);
    const title = firstTitle?.trim() ? `“${firstTitle}”` : "your browser menu";
    const addIt = await confirm({
      message: `Add ${title} from this browser to your account when you sign in?`,
      confirmLabel: "Add it on sign-in",
      cancelLabel: "Don't add it",
    });
    // Sample rows go quietly whichever answer the owner gives; the intent
    // names only real menus.
    for (const id of demo) await dissolveBrowserMenu(id);
    if (addIt) {
      saveDirectSignInIntent({ decision: "attach", menuIds: askable });
      router.push("/sign-in");
      return;
    }
    // Signed out there is no library to export from, so the backup
    // instruction names nothing — the choice is delete or stay.
    const wipeIt = await confirm({
      message: `Delete ${title} from this browser and sign in without it? This cannot be undone.`,
      confirmLabel: "Delete and sign in",
      cancelLabel: "Stay here",
      destructive: true,
    });
    if (!wipeIt) return;
    saveDirectSignInIntent({ decision: "discard", menuIds: askable });
    router.push("/sign-in");
  }

  async function handleDeleteMenu(id: string) {
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
      await deleteMenu(id);
      await clearDraftOrigin(id);
      removeServerId(id);
      forgetOpenDoc(id);
      resetPublication();
      await refreshLibrary();
      if (accountNote) reportLibraryError(accountNote);
      navigate({ screen: "library" }, { flushCurrent: false });
    } catch (error) {
      reportLibraryError(
        error instanceof StorageError ? error.message : "Could not delete that menu."
      );
    }
  }

  async function handleBackToLibrary() {
    await flushSave();
    clearImage();
    await refreshLibrary();
    void mergeAccountMenus(activeRestaurantId);
    navigate({ screen: "library" }, { flushCurrent: false });
  }

  // --- Capture flow -------------------------------------------------------

  function scrollToResult() {
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  async function confirmDiscard(
    message = "This will discard the current extracted menu. Continue?"
  ): Promise<boolean> {
    if (!extracted && !demoDoc) return true;
    return confirm({ message, confirmLabel: "Discard", destructive: true });
  }

  /**
   * Swap the whole selection for `nextFiles`: release old preview URLs,
   * show the new ones, and drop any stale extraction result. Callers have
   * already confirmed discarding and validated the batch.
   */
  /**
   * Persist the current result and open it. The wizard entry point reuses
   * this without touching the URL, then navigates once to its own mode.
   */
  async function saveResultAndOpen(updateRoute = true): Promise<MenuDocument> {
    // `extracted` is null for a draft resumed after a reload: the stored
    // document is the work, so the same path opens it instead of pretending
    // this is a fresh sample menu. The hook answers "what is this capture
    // about to become", reusing the autosaved draft.
    const pending = documentForSave();
    if (pending) {
      const { doc, firstPage } = pending;
      // Server-only while signed in: no browser-only copy is ever written.
      // A failure throws to the result screen's error path with the data
      // intact, so the next press retries instead of forking a local copy.
      if (signedInRef.current) {
        if (storageDownRef.current) {
          throw new StorageError(
            "unavailable",
            "Browser storage is unavailable, so the menu can't be cached. Try again."
          );
        }
        const alreadyOnServer = serverIdsRef.current.has(doc.id);
        if (alreadyOnServer) {
          const access = menuAccessRef.current.get(doc.id);
          await refreshLibrary();
          await openDoc(doc, firstPage ? firstPage.file : null, updateRoute, access);
          return doc;
        }
        const targetId = await ensureServerTarget(doc.title, activeRestaurantId, signedInCanWrite);
        if (!targetId) {
          throw new StorageError(
            "unavailable",
            "Couldn't reach your account. Check your connection and try again."
          );
        }
        let server: ServerMenu;
        try {
          server = await createServerMenu(targetId, doc);
        } catch (serverError) {
          if (serverError instanceof SyncError && serverError.code === "exists") {
            server = await fetchServerMenu(doc.id);
          } else {
            throw serverError;
          }
        }
        if (firstPage) {
          try {
            await saveImage(server.id, firstPage.file);
          } catch {
            // Image is optional; the menu matters.
          }
        }
        const cached = await cacheServerDraft(server);
        await refreshLibrary();
        await openDoc(cached, firstPage ? firstPage.file : null, updateRoute, server.access);
        return cached;
      }
      const saved = storageDownRef.current ? doc : await saveMenu(doc);
      if (firstPage && !storageDownRef.current) {
        try {
          // One blob per menu: the first page stands in as the source image.
          await saveImage(saved.id, firstPage.file);
        } catch {
          // Image is optional; the menu matters.
        }
      }
      await pruneSignedOutOthers(saved.id);
      if (!storageDownRef.current) await refreshLibrary();
      await openDoc(saved, firstPage ? firstPage.file : null, updateRoute, "local");
      return saved;
    }
    const doc = demoDoc ?? createSampleMenuDocument();
    if (signedInRef.current) {
      if (storageDownRef.current) {
        throw new StorageError(
          "unavailable",
          "Browser storage is unavailable, so the menu can't be cached. Try again."
        );
      }
      const demoTarget = await ensureServerTarget(doc.title, activeRestaurantId, signedInCanWrite);
      if (!demoTarget) {
        throw new StorageError(
          "unavailable",
          "Couldn't reach your account. Check your connection and try again."
        );
      }
      let demoServer: ServerMenu;
      try {
        demoServer = await createServerMenu(demoTarget, doc);
      } catch (serverError) {
        if (serverError instanceof SyncError && serverError.code === "exists") {
          demoServer = await fetchServerMenu(doc.id);
        } else {
          throw serverError;
        }
      }
      const cached = await cacheServerDraft(demoServer);
      await refreshLibrary();
      await openDoc(cached, null, updateRoute, demoServer.access);
      return cached;
    }
    const saved = storageDownRef.current ? doc : await saveMenu(doc);
    await pruneSignedOutOthers(saved.id);
    if (!storageDownRef.current) await refreshLibrary();
    await openDoc(saved, null, updateRoute, "local");
    return saved;
  }

  function showOpenError(error: unknown) {
    setExtractError(
      new ExtractClientError(
        "internal_error",
        error instanceof StorageError ? error.message : "Could not open the editor. Try again."
      )
    );
    scrollToResult();
  }

  /** Point every result-screen confirmation at the same canonical doc. */
  /** The signed-out resume banner: load the draft, then return to Capture. */
  async function handleResumeCapture(menuId: string) {
    const doc = await resumeDraft(menuId);
    if (!doc) return;
    setResumeDismissed(true);
    navigate({ screen: "capture" });
    scrollToResult();
  }

  async function handleEditResult() {
    try {
      await saveResultAndOpen();
    } catch (error) {
      showOpenError(error);
    }
  }

  /** From the extraction result: save the draft, then open the publish wizard.
   * The marker lets that screen continue the four-stop journey; a menu opened
   * straight from the library gets a plain heading instead of a false "3 done". */
  async function handleStartPublish() {
    try {
      const saved = await saveResultAndOpen(false);
      rememberPublishJourney(saved.id);
      navigate({ screen: "editor", menuId: saved.id, mode: "publish" });
    } catch (error) {
      showOpenError(error);
    }
  }

  const activeStep = stepIndex(phase, result !== null);
  const assistantPending = sessionPending || (signedIn && featureFlagsLoading);

  // Sign-out is a privacy boundary: stamped rows belong to their owner and
  // never render for anyone else (or for nobody signed out); anonymous rows
  // are the shared working set. Hidden rows also stay out of the claim
  // offer, the manual import, the tab count, and the restaurant name guess.
  // A published-only reader gets the live snapshot even when this browser's
  // cached row is stamped to the account that wrote the draft (the owner
  // sharing a device with staff). The server has already projected the
  // content to the published revision, so the row is safe to show.
  const sharedLiveMenuIds = new Set(
    [...serverIds].filter((id) => isPublishedOnlyAccess(menuAccess.get(id)))
  );
  const visibleIds = new Set(
    visibleMenuIds(
      menus.map((menu) => menu.id),
      originList,
      signedIn ? accountKey : null,
      sharedLiveMenuIds
    )
  );
  const visibleMenus = menus.filter((menu) => visibleIds.has(menu.id));
  const hasHiddenMenus = visibleMenus.length !== menus.length;
  /**
   * The chip column may only speak once the account's menu list has been read
   * (001). Before that an empty id set is "not asked yet", so the rows keep
   * their skeleton; after a *failed* read they render with no chip at all —
   * an unknown membership is never reported as "this browser only".
   */
  // The gate reads the *settled* marker, not the id set: a read that failed
  // still ends the wait (rows appear without a chip), while only a read that
  // answered lets the rows name membership (001).
  const libraryAccountPending = sessionPending || (signedIn && serverMenusReadFor !== accountKey);
  const libraryAccountMode = signedIn && serverMenusFor === accountKey;
  /**
   * Server-only creation (signed-in): a new menu is a cloud copy, never a
   * browser-only draft. Prefers the café the shell acts in when it may file
   * there, else the owner's first café; a brand-new account gets its café
   * provisioned from the menu title instead of a local draft (publishing can
   * no longer be the first server write). Staff-only contexts return null —
   * there is no café the caller may file in, and nothing is invented behind
   * anyone's back. The café and the permission arrive as arguments, so an
   * async save decides on the membership its own caller was acting in.
   */
  async function ensureServerTarget(
    menuTitle: string,
    restaurantId: string | null,
    canWrite: boolean
  ): Promise<string | null> {
    if (!signedInRef.current || !accountKeyRef.current) return null;
    if (restaurantId && canWrite) return restaurantId;
    if (ownedRestaurantsForAccount.length > 0 && ownedRestaurantsForAccount[0]) {
      return ownedRestaurantsForAccount[0].id;
    }
    if ((restaurantList?.length ?? 0) > 0) return null;
    try {
      const created = await createRestaurant(suggestRestaurantName([menuTitle]) ?? "My restaurant");
      workspace.addRestaurant(created);
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
  /**
   * Switch the membership the shell acts in. Stored under the account, so a
   * staff context chosen on a shared device never greets the next person.
   *
   * The open editor belongs to its menu's café, so switching to a different
   * one leaves the editor for the new café's library instead of keeping a
   * menu on screen under a café it does not belong to. A browser-only draft
   * has no café, so it stays only where the new membership can write.
   */
  function handleSwitchWorkspace(key: string) {
    const target = workspaces.find((entry) => entry.key === key) ?? null;
    switchWorkspace(key);

    const menuId = routeMenuId(route);
    if (!menuId) return;
    const menuRestaurantId = menuRestaurantById.get(menuId);
    const belongsToTarget = menuRestaurantId
      ? menuRestaurantId === target?.restaurantId
      : workspaceCan(target, "menus.write");
    if (!belongsToTarget) navigate({ screen: "library" });
  }
  /**
   * The acting café's rows. The account read is café-keyed, so every server
   * row already belongs here — there is no per-row café to filter on. Only
   * browser drafts still need a rule: they belong to a membership that can
   * write, and wait (hidden) on a staff shift until the owner files them.
   */
  const workspaceMenus =
    !signedIn || accountCan("menus.write")
      ? visibleMenus
      : visibleMenus.filter((menu) => serverIds.has(menu.id));
  /**
   * The tab's number is a fact about one café, so it waits for that café's
   * read to settle — answered or failed. Signed out the working set is the
   * whole list, so it is known already.
   */
  const libraryCountKnown =
    !signedIn || serverMenusReadFor === accountKey || serverMenusReadFailedFor === accountKey;
  // Library rows carry their account state: menus on the server show as
  // synced; the rest are browser-only until moved (or downloaded).
  const libraryMenus = workspaceMenus.map((menu) => ({
    ...menu,
    onServer: serverIds.has(menu.id),
    // The row's verbs follow the same answer as the editor. An unanswered
    // menu is read-only here too, so no owner control appears on a guess.
    canWrite: !signedIn || accessCan(menuAccess.get(menu.id), "menus.write"),
  }));
  const localOnly = libraryMenus.filter((menu) => !menu.onServer);
  const localOnlyCount = localOnly.length;

  // The resume banner names one menu as an unpublished browser draft, which it
  // reads off the account's id set — so it waits for that set to have actually
  // answered. A failed read settles the gate (002's notice says so), but it
  // cannot tell an account menu from a draft: every menu would look local and
  // the banner would hand an account menu back as unpublished (017).
  /** The newest draft the resume banner can offer, if any is readable. */
  const resumableDraft = localOnly.find((menu) => !menu.corrupt) ?? null;
  /** Everything the signed-out resume banner needs before it may render. */
  const resumeBannerVisible =
    screen === "capture" &&
    !signedIn &&
    result === null &&
    resumeDismissed === false &&
    localOnlyCount > 0 &&
    claimSurfaceQuiet;
  const resumeReady = resumeBannerReady({
    libraryLoading,
    gate: claimGate,
    signedIn,
    accountMenusSettled: libraryAccountMode,
  });

  /**
   * The menu the URL names. Leaving the editor for the library keeps the
   * document in memory on purpose (mode changes and returns skip the read),
   * but that copy is never a stand-in for a *different* menu: entering
   * another one must show its own loading state until its copy arrives, not
   * the previous menu's rows — which could even be edited into the wrong
   * record.
   */
  const routedDoc = docForRoutedMenu(activeDoc, route);
  // Publish state is only ever shown for the menu it was loaded for; a stale
  // answer for a previously opened menu is never displayed.
  const activePublicationMenuId = routedDoc?.id ?? null;
  const activePublication = publicationMenuId === activePublicationMenuId ? publication : null;
  const activePublicationLoaded =
    publicationMenuId === activePublicationMenuId && publicationLoaded;
  /**
   * The open menu's access answer. Missing is unanswered, not permission: the
   * editor renders a placeholder until the server says what this caller may
   * do. Staff without `menus.write` get a preview; a menu the server refused
   * (`"none"`) is never rendered, cached draft or not.
   */
  const activeMenuAccess = activeDoc ? menuAccess.get(activeDoc.id) : undefined;
  const activeMenuAccessPending = signedIn && activeDoc != null && activeMenuAccess === undefined;
  const activeMenuAccessDenied = activeMenuAccess === "none";
  const activeMenuCanWrite = !signedIn || accessCan(activeMenuAccess, "menus.write");
  const activeMenuCanPublish = !signedIn || accessCan(activeMenuAccess, "menus.publish");
  // Staff on the menu's restaurant get a view-only editor (the server refuses
  // their writes anyway; the UI must not offer the controls at all).
  const activeMenuIsStaff = accessIsStaff(activeMenuAccess) && !activeMenuCanWrite;

  /**
   * The switcher follows the menu. A deep link can open a menu from the other
   * café — the account can read it — while the shell is still acting in the
   * café it was left in, which would leave the switcher and the screen
   * disagreeing. Select the menu's café instead, once that café is known and
   * the account actually holds it. Only the routed menu counts: a document
   * kept in memory while browsing the library must not drag the context back.
   */
  const routedMenuRestaurantId = routedDoc ? (menuRestaurantById.get(routedDoc.id) ?? null) : null;
  const followMenuCafe =
    signedIn &&
    !accountAccessPending &&
    accountKey !== null &&
    routedMenuRestaurantId !== null &&
    routedMenuRestaurantId !== activeWorkspace?.restaurantId &&
    workspaces.some((entry) => entry.restaurantId === routedMenuRestaurantId);

  /**
   * Every surface follows the one navigation table: a section is visible only
   * when the active membership holds its capability (signed out: Capture
   * plus the anonymous working set). The pills, tab bar and More sheet all
   * read this list, so they cannot drift apart, and a section contributed
   * later cannot appear ungated.
   */
  const sections = availableSections({
    signedIn,
    can: accountCan,
    assistantEnabled: featureFlags.assistant,
  });
  /**
   * The sidebar renders the same table, with the library's number filled in
   * once it is a fact about the active café (`libraryCountKnown`).
   */
  const navSections = sections.map((section) =>
    section.id === "library" && libraryCountKnown
      ? { ...section, count: libraryMenus.length }
      : section
  );
  const availableScreenIds = new Set(sections.map((section) => section.id));
  const phoneTabList = phoneTabs(sections);
  const moreRows = moreSheetRows(sections);
  /**
   * The left column belongs to the account. A visitor with nothing in the
   * library gets the entry page instead of a one-row menu, and the brand row
   * takes over the name and `/sign-in` at every width.
   *
   * Nothing is assumed while the session or the library is still answering:
   * The library's own read is part of it too: the session is not settled
   * until its read answers, so the column stays off until both are known
   * instead of flashing account chrome at a visitor.
   */
  const showShellColumn =
    !sessionPending && !libraryLoading && shellColumnVisible({ sessionState });
  /** Nav waits for the membership read: no provisional tabs, no empty bar. */
  const navReady = !sessionPending && !accountAccessPending;
  /**
   * Capture's first frame waits for the same two answers as the column:
   * rendering the page before they land flashes the plain working layout
   * at a visitor whose entry composition arrives a moment later.
   */
  const shellReady = !sessionPending && !libraryLoading;
  /** The More sheet owns the current screen (and so shows as pressed). */
  const screenInMore = moreRows.some((row) => row.id === screen);
  const canGetStarted = signedIn && accountCan("settings.manage");
  /** Why an empty library is empty, when the shell can tell. */
  const libraryEmpty = (() => {
    if (!signedIn || restaurantList === null) return undefined;
    if (restaurantList.length === 0) {
      return {
        title: "No café on this account yet",
        body: "If you were invited, open the invitation link from your email, or ask the owner to add this address in Settings → Team. Otherwise, capture a menu to start your own café.",
      };
    }
    if (activeWorkspace === null) return undefined;
    // The list is the active café's, so the empty state names that café — not
    // the account, whose other café may be full of menus.
    return {
      title: `No menus at ${activeWorkspace.name} yet`,
      body: accountCan("menus.write")
        ? "Capture a menu or start a blank one — it will appear here and survive refreshes."
        : "Staff see this café's published menus only. Ask the owner to publish one; drafts and unpublished menus stay private until then.",
    };
  })();

  /**
   * The sidebar's contextual half: the open menu's sections, only while the
   * edit workspace is showing. Reorder and preview have their own shape, and
   * a publish wizard has no sections to jump between.
   */
  const sidebarOutline =
    screen === "editor" && editorMode === "edit" && routedDoc
      ? routedDoc.categories.map((category) => ({
          id: category.id,
          name: category.name.trim() || "Untitled category",
          itemCount: category.items.length,
        }))
      : null;
  const sidebarOutlineKey = sidebarOutline?.map((section) => section.id).join("|") ?? "";
  /**
   * Unfinished checklist for this account **and this café** only: another
   * membership's count is never shown, and complete or unknown hides the row.
   */
  const launchChecklistForActive =
    launchChecklist &&
    launchChecklist.accountKey === accountKey &&
    launchChecklist.restaurantId === activeRestaurantId
      ? launchChecklist
      : null;
  const sidebarLaunch =
    signedIn && launchChecklistForActive && !launchChecklistForActive.complete
      ? { done: launchChecklistForActive.done, total: launchChecklistForActive.total }
      : null;
  /** The More sheet's checklist line: progress, finished, or not read yet. */
  const sheetLaunchHint = sidebarLaunch
    ? "What's left to set up"
    : launchChecklistForActive
      ? "All steps done"
      : "See what's left to set up";
  /**
   * The My menus count is only true once the account's list has been read.
   * Before that the local set can be smaller than the account's, so the
   * sidebar holds a placeholder rather than a number that will jump. A read
   * that failed is settled, not pending: it gets no skeleton and no number.
   */
  const sidebarMenuCountPending =
    !sessionPending &&
    (libraryLoading || (signedIn && !libraryCountKnown && serverMenusReadFailedFor !== accountKey));

  /** Jump the editor list to the section chosen in the sidebar. */
  function scrollToMenuSection(categoryId: string) {
    document.getElementById(`menu-section-${categoryId}`)?.scrollIntoView({ block: "start" });
  }

  // The route opener has to act with the latest `openDoc` without re-running
  // whenever a render recreates it; an effect event is the supported way to
  // read a fresh closure from an effect.
  const openDocEvent = useEffectEvent(openDoc);

  // EFFECTS MOVED BELOW FUNCTIONS: every effect runs after the
  // functions it calls. Order among them is the original order, so the
  // render -> effect sequence is unchanged.

  // Signed out is capture-only (plus the library working set and the editor
  // for anonymous drafts): orders/tables/settings/assistant need an account,
  // so a signed-out visitor who lands on one (typed URL, old bookmark)
  // goes back to capture. Runs every render by design; the guard goes
  // quiet once the screen moves on, and stays inert while the session read is
  // unanswered (015): unknown is not signed out.
  useEffect(() => {
    if (sessionState === "signed-out") {
      const guarded = route.screen;
      if (
        guarded === "assistant" ||
        guarded === "orders" ||
        guarded === "tables" ||
        guarded === "settings"
      ) {
        navigate({ screen: "capture" }, { replace: true });
      }
    }
  });

  useEffect(() => {
    signedInRef.current = signedIn;
    sessionStateRef.current = sessionState;
    accountKeyRef.current = accountKey;
  }, [signedIn, sessionState, accountKey]);

  useEffect(() => {
    return () => {
      if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pending save lives with navigation: it flushes before leaving a menu.
  // Registered after every commit so navigation always holds the latest
  // closure, without writing to the provider's ref during render.
  useEffect(() => {
    registerSaveFlush(flushSave);
  });

  useEffect(() => {
    if (!navigationReady || !routeMenuId(route) || sessionState === "unknown") return;
    const menuId = routeMenuId(route);
    if (!menuId) return;
    if (getOpenDocId() === menuId) {
      openedRouteMenuRef.current = menuId;
      // Fast path: the doc is already in memory (editor mode switches, and
      // returns to a menu that was left open). "Back to library" releases
      // the source image URL while keeping the doc, so returning through
      // this path re-reads the image — the document itself is not re-read.
      let imageCancelled = false;
      void (async () => {
        try {
          const stored = await getImage(menuId);
          if (imageCancelled || getOpenDocId() !== menuId) return;
          showImage(stored?.blob ? URL.createObjectURL(stored.blob) : null);
        } catch {
          // The editor is fully usable without the image; the next full
          // open of this menu retries the read.
        }
      })();
      return () => {
        imageCancelled = true;
      };
    }
    if (openedRouteMenuRef.current === menuId) return;
    openedRouteMenuRef.current = menuId;
    let cancelled = false;

    void (async () => {
      try {
        let doc: MenuDocument;
        let imageBlob: Blob | null = null;
        let accessHint: MenuAccess | undefined;
        try {
          doc = await getMenu(menuId);
          // The device stamp is a privacy boundary, not an accusation (015): a
          // row stamped to this account is the account's own copy, an unstamped
          // row is the shared anonymous working set, and only a row stamped to
          // somebody else stays shut. An unanswered session decides nothing
          // here — the effect re-runs when the read settles.
          const origin = await getDraftOrigin(menuId).catch(() => undefined);
          // The server's own list is the second authority for a shared
          // browser: a published menu it listed for this account opens even
          // when the local row is stamped to the owner who wrote the draft.
          const sharedPublished =
            accountMenusSettledRef.current === accountKeyRef.current &&
            isPublishedOnlyAccess(menuAccessRef.current.get(menuId));
          const access = decideMenuOpen({
            session: sessionStateRef.current,
            stampAccountId: origin?.accountId,
            accountKey: accountKeyRef.current,
            sharedPublished,
            accountReadPending: signedIn && serverMenusReadFor !== accountKey,
          });
          if (access.state === "wait") {
            if (cancelled) return;
            openedRouteMenuRef.current = null;
            return;
          }
          if (access.state === "blocked") {
            // A torn-down run must never navigate: this was the one branch in
            // the effect without the cancellation guard (015).
            if (cancelled) return;
            reportLibraryError(menuOpenBlockedMessage(access.reason));
            openedRouteMenuRef.current = null;
            navigate({ screen: "library" }, { replace: true });
            return;
          }
          try {
            imageBlob = (await getImage(menuId))?.blob ?? null;
          } catch {
            imageBlob = null;
          }
        } catch (localError) {
          if (!signedIn) throw localError;
          const serverMenu = await fetchServerMenu(menuId);
          rememberMenuCafe(serverMenu.id, serverMenu.restaurantId);
          doc = serverMenu.doc;
          accessHint = serverMenu.access;
          await cacheMenu(doc).catch(() => undefined);
          await refreshLibrary();
        }
        if (!cancelled) await openDocEvent(doc, imageBlob, false, accessHint);
      } catch {
        if (cancelled) return;
        openedRouteMenuRef.current = null;
        // A refresh before the first change: the URL names a menu that was
        // never saved, so there is nothing to report — back quietly.
        if (route.screen === "editor" && menuId && isPendingNewMenu(menuId)) {
          forgetPendingNewMenu(menuId);
          navigate({ screen: "library" }, { replace: true });
          return;
        }
        // A dead publish link holds its URL with an explainer card — the
        // draft is in another browser, and the library can't show that.
        if (route.screen === "editor" && route.mode === "publish") {
          markMissingPublish(menuId);
          return;
        }
        reportLibraryError(unresolvableMenuMessage(route));
        navigate({ screen: "library" }, { replace: true });
      }
    })();

    return () => {
      cancelled = true;
      if (openedRouteMenuRef.current === menuId) openedRouteMenuRef.current = null;
    };
  }, [
    route,
    sessionState,
    signedIn,
    accountKey,
    serverMenusReadFor,
    navigationReady,
    navigate,
    markMissingPublish,
    // The open document's id and the library's own answers: stable reads, so
    // listing them never re-runs this effect on a render of its own.
    getOpenDocId,
    showImage,
    accountMenusSettledRef,
    menuAccessRef,
    refreshLibrary,
    rememberMenuCafe,
    reportLibraryError,
  ]);

  useEffect(() => {
    const wasSignedIn = wasSignedInRef.current;
    wasSignedInRef.current = signedIn;
    if (signedIn && accountKey) prevAccountKeyRef.current = accountKey;

    if (!signedIn) {
      // Sign-out is a privacy boundary. An open editor or a result on
      // Capture can hold an account menu, so a real session end dismisses
      // both and lands on Capture. Anonymous drafts stay for the capture
      // banner; account copies proved in sync are dissolved below, so the
      // landed screen never offers a menu that is already on the account.
      const landing = signOutLandingRoute({ wasSignedIn, signedIn });
      // Release the document before anything else: a menu the session no
      // longer owns must not stay open, and pending account work bails once
      // the unit's ref is null. The unit keeps the latest local edits.
      if (landing) releaseOpenDoc();
      accountMenusSettledRef.current = null;
      // State is compared with accountKey when read, so a stale value from
      // the previous session can never authorise an import for this one.
      resetClaimState();
      // The shell answers a session end by clearing what the account owned.
      // Deferred like the other account reads in this file: an effect must not
      // set state synchronously while rendering the frame that decided it. The
      // refs above are already cleared, so nothing can reopen the editor into
      // the gap, and a microtask still lands before the next paint.
      void Promise.resolve().then(() => {
        if (landing) {
          resetActiveMenu();
          resetPublication();
          if (resultDoc !== null || pages.length > 0) applySelection([]);
          navigate(landing, { replace: true, flushCurrent: false });
        }
        // The ids and the read that produced them reset together (001): a stale
        // "settled" marker over an empty id set would let the next sign-in paint
        // the same false chip.
        resetAccountAnswer();
      });
      // Server-only at rest: account copies proved in sync leave with the
      // session, so a later sign-in never asks about a menu that is
      // already there. Anything unproven stays hidden until the heal (or
      // the claim) sees it — an interrupted edit is never dissolved.
      const leavingAccount = prevAccountKeyRef.current;
      prevAccountKeyRef.current = null;
      if (leavingAccount) {
        void (async () => {
          try {
            for (const id of await collectSignOutDissolveIds(leavingAccount, getMenu)) {
              await dissolveBrowserMenu(id);
            }
          } catch {
            // Best-effort: leftovers stay stamped and hidden, never asked about.
          }
          await refreshLibrary();
        })();
      }
      return;
    }
    // Sign-in: merge account menus into the library, heal interrupted work
    // from closed menus, and reconcile a menu that was already open. A menu
    // that was never moved to the account stays local-only (serverBaseRef
    // stays null), so this cannot loop.
    void Promise.resolve().then(refreshLibrary);
    void Promise.resolve().then(healStampedDrafts);
    // The document that was already open reconciles itself; the shell only
    // follows it with the publication answer.
    const openDocId = resyncOpenDoc();
    if (openDocId) void refreshPublication(openDocId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Refresh the sidebar's launch progress when the account, the café, or the
  // screen changes: publishing or a first order moves the count, and the next
  // navigation is when the owner sees it. It asks for the café the shell is
  // acting in — never the account's other memberships — and waits for that
  // café to be resolved. A failed read hides the row instead of guessing.
  useEffect(() => {
    // Nothing to read without an account and a café. The stored count is not
    // cleared here (a synchronous setState in an effect); the render compares
    // account and café, so an old membership's count can never show.
    if (!signedIn || !accountKey || !activeRestaurantId) return;
    let cancelled = false;
    void fetchLaunchStatus(activeRestaurantId)
      .then((status) => {
        if (cancelled) return;
        const progress = launchProgress(status, cardsPrintedOnThisDevice());
        setLaunchChecklist({
          accountKey,
          restaurantId: activeRestaurantId,
          ...progress,
        });
      })
      .catch(() => {
        if (!cancelled) setLaunchChecklist(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, accountKey, activeRestaurantId, screen]);

  // Confirm the dismissal only after the inputs settle, so the banner's
  // very first render is already a confirmed decision, not an assumption.
  // Deferred exactly like the auto-import below: while unconfirmed the
  // banner renders nothing, so waiting a tick for the confirmation costs
  // nothing visually and keeps state out of the effect body.
  useEffect(() => {
    if (!resumeReady || resumeDismissed !== null) return;
    void Promise.resolve().then(() => setResumeDismissed(false));
  }, [resumeReady, resumeDismissed]);

  useEffect(() => {
    if (!followMenuCafe || !routedMenuRestaurantId) return;
    // Deferred like the other account reads: never set state synchronously
    // while rendering the frame that decided to switch.
    void Promise.resolve().then(() => switchWorkspace(routedMenuRestaurantId));
  }, [followMenuCafe, routedMenuRestaurantId, switchWorkspace]);

  // A typed URL or old bookmark for a surface this membership cannot use
  // lands on the first one it can — Capture for an owner, My menus for a
  // staff shift. Unknown access is not a refusal: the guard waits.
  useEffect(() => {
    if (!signedIn || accountAccessPending) return;
    const guarded = route.screen;
    if (guarded === "assistant" && featureFlagsLoading) return;
    // The editor and item pages answer for themselves: their menu carries
    // the server's own access answer, and a foreign menu moves the
    // switcher (below) rather than being refused here.
    if (guarded === "editor" || guarded === "item") return;
    // A membership with no usable surface has nowhere to send anyone; it
    // keeps the page it has rather than bouncing between two refusals.
    const landing = sections[0]?.id;
    if (!availableScreenIds.has(guarded) && landing) {
      navigate({ screen: landing }, { replace: true });
    }
  });

  // Signed out there is no My menus, no editor, no Orders or Settings, and
  // no navigation to get back with: an old bookmark for any of them returns
  // to Capture, where the resume banner offers any draft left behind. The
  // onboarding publish step is the one exception — the emailed magic link
  // returns there — so its URL keeps working for a visitor.
  useEffect(() => {
    if (signedIn || sessionPending) return;
    if (libraryLoading) return;
    const routed = route;
    const onboarding = routed.screen === "editor" && routed.mode === "publish";
    if (routed.screen === "capture" || onboarding) return;
    // Deferred like the other account reads: the effect must not set state
    // synchronously while rendering the frame that decided it.
    void Promise.resolve().then(() => navigate({ screen: "capture" }, { replace: true }));
  });

  return (
    <AppShell
      dialog={dialog}
      screen={screen}
      // The editor is the dense working surface; the publish step is
      // onboarding and keeps the content measure.
      wideMeasure={screen === "editor" && editorMode !== "publish"}
      signedIn={signedIn}
      sessionPending={sessionPending}
      email={email}
      userId={userId}
      restaurantId={activeWorkspace?.restaurantId ?? null}
      monitorPending={sessionPending || accountAccessPending}
      showColumn={showShellColumn}
      sidebar={{
        sections: navReady ? navSections : [],
        ready: navReady,
        outline: sidebarOutline,
        outlineKey: sidebarOutlineKey,
        onOutlineSelect: scrollToMenuSection,
        launch: sidebarLaunch,
        menusPending: sidebarMenuCountPending,
      }}
      workspaces={workspaces}
      activeWorkspace={activeWorkspace}
      onSwitchWorkspace={handleSwitchWorkspace}
      phone={{
        ready: navReady,
        tabs: phoneTabList,
        moreRows,
        moreOpen,
        onToggleMore: () => setMoreOpen((open) => !open),
        onCloseMore: () => setMoreOpen(false),
        screenInMore,
        canGetStarted,
        launchHint: sheetLaunchHint,
      }}
      onNavigate={(section) => navigate({ screen: section })}
      onHome={() => navigate({ screen: "capture" })}
      // Every in-shell sign-in goes through the choice first: attach the
      // browser draft on login or wipe it on login.
      onSignIn={!signedIn ? () => void requestDirectSignIn() : undefined}
      onSignOut={() => void authClient.signOut()}
      onOpenOrders={() => navigate({ screen: "orders" })}
    >
      {signedIn && claimError && (
        <div
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>{claimError}</p>
            <button
              type="button"
              onClick={() => setClaimError(null)}
              className="text-xs font-medium underline underline-offset-2 hover:text-danger-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* A failed account read is no longer silent: the gate settles, the
            server paths stay off, and this says so once. */}
      {signedIn && claimGate.incomplete && screen !== "editor" && (
        <p className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-xs leading-5 text-ink-600">
          We couldn&apos;t check your account just now, so nothing was imported from this browser.
          Reload when you&apos;re back online and it will try again.
        </p>
      )}

      {/* Q7 resume banner, signed out only: the way back for anyone
            who wandered off with a saved-but-unpublished draft. Signed out
            there is no library to go back to, so the banner resumes the
            newest draft on Capture itself — the screen the work happened
            on. It renders only after the library answers and only with a
            confirmed `resumeDismissed === false`: until then it is
            invisible, never provisional. Hidden while the result is on
            screen (it IS the continue path), and signed in it never
            renders at all — signing in dissolves the rows instead. */}
      {resumeBannerVisible && resumeReady && resumableDraft ? (
        <HeightReveal>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-warning-950">Pick up where you left off</p>
              <p className="mt-0.5 max-w-xl text-xs leading-5 text-warning-900">
                {localOnlyCount === 1
                  ? `“${resumableDraft.title}” is still saved in this browser — reopen it here and keep going.`
                  : `${localOnlyCount} menus are saved in this browser — reopen “${resumableDraft.title}” and keep going.`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleResumeCapture(resumableDraft.id)}
                className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Resume →
              </button>
              <button
                type="button"
                onClick={() => setResumeDismissed(true)}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-900 transition-colors hover:text-accent-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Dismiss
              </button>
            </div>
          </div>
        </HeightReveal>
      ) : null}

      {screen === "library" && (
        <MenusPage
          error={visibleLibraryError}
          menus={libraryMenus}
          loading={libraryLoading || libraryAccountPending}
          accountMode={libraryAccountMode}
          canCreate={!signedIn || accountCan("menus.write")}
          hasHiddenMenus={hasHiddenMenus}
          emptyTitle={libraryEmpty?.title}
          emptyBody={libraryEmpty?.body}
          unavailable={storageDown}
          onOpen={(id) => void handleOpenMenu(id)}
          onNew={(suggestedTitle?: string) => void handleNewMenu(suggestedTitle)}
          onRename={(id, title) => void handleRenameMenu(id, title)}
          onDelete={(id) => void handleDeleteMenu(id)}
          onSignIn={!signedIn ? () => void requestDirectSignIn() : undefined}
        />
      )}

      {screen === "orders" && <OrdersPage />}

      {screen === "assistant" && (
        <AssistantPage
          signedIn={signedIn}
          sessionPending={sessionPending}
          pending={assistantPending}
          enabled={featureFlags.assistant}
          proposalsEnabled={featureFlags.assistantProposals}
          menusLoading={libraryLoading}
          menus={workspaceMenus
            .filter(
              (menu) => serverIds.has(menu.id) && accessCan(menuAccess.get(menu.id), "menus.write")
            )
            .map((menu) => ({ id: menu.id, title: menu.title }))}
          onBackToCapture={() => navigate({ screen: "capture" })}
        />
      )}

      {screen === "tables" && <TablesPage />}

      {screen === "settings" && <SettingsPage />}

      {screen === "editor" && routedDoc && (
        <>
          {conflict && (
            <ConflictBanner
              serverUpdatedAt={conflict.serverUpdatedAt}
              error={conflictError}
              onReloadServer={() => void handleLoadServerVersion()}
              onKeepMine={() => void handleKeepMyVersion()}
            />
          )}
          {activeMenuAccessDenied ? (
            <section className="rounded-2xl border border-line-200 bg-surface-base p-6">
              <h1 className="font-medium text-ink-900">This menu isn’t available</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-600">
                Your account can’t open this menu. Ask the restaurant owner if you think that’s a
                mistake.
              </p>
              <button
                type="button"
                onClick={() => void handleBackToLibrary()}
                className="mt-4 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Back to my menus
              </button>
            </section>
          ) : activeMenuAccessPending ? (
            <section
              role="status"
              aria-busy="true"
              aria-label="Checking access"
              className="flex flex-col gap-3 rounded-2xl border border-line-200 bg-surface-base p-6"
            >
              <span className="sr-only">Checking your access to this menu…</span>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-40 w-full" />
            </section>
          ) : (
            <>
              {activeMenuIsStaff && (
                <p className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900">
                  You have staff access to this restaurant — menus are view-only for staff. Ask an
                  owner to make changes.
                </p>
              )}
              {editorMode === "publish" && activeMenuCanPublish ? (
                <PublishWizard
                  key={routedDoc.id}
                  doc={routedDoc}
                  signedIn={signedIn}
                  sessionPending={sessionPending}
                  accountKey={accountKey}
                  ownedRestaurants={ownedRestaurantsForAccount}
                  restaurantsLoading={restaurantsLoading}
                  onPublished={handleWizardPublished}
                  onBack={() => navigate({ screen: "editor", menuId: routedDoc.id, mode: "edit" })}
                  onOpenTables={() => navigate({ screen: "tables" })}
                  onOpenEditor={() =>
                    navigate({ screen: "editor", menuId: routedDoc.id, mode: "edit" })
                  }
                />
              ) : (
                <MenuEditor
                  doc={routedDoc}
                  selectedItemId={selectedItemId}
                  mode={activeMenuCanWrite ? editorMode : "preview"}
                  onModeChange={(mode) =>
                    navigate({ screen: "editor", menuId: routedDoc.id, mode })
                  }
                  onChange={handleDocChange}
                  saveState={saveState}
                  syncMode={signedIn ? "account" : "local"}
                  canManage={activeMenuCanWrite}
                  onServer={activeMenuOnServer}
                  accountCheckFailed={activeMenuAccountCheckFailed}
                  onRetryAccountCheck={retryAccountCheck}
                  restaurantName={
                    ownedRestaurantsForAccount.find(
                      (restaurant) => restaurant.id === activePublication?.restaurantId
                    )?.name ?? null
                  }
                  onStartPublish={() =>
                    navigate({ screen: "editor", menuId: routedDoc.id, mode: "publish" })
                  }
                  imageUrl={editorImageUrl}
                  onExportJson={handleExportJson}
                  onExportCsv={handleExportCsv}
                  onImportFile={(f) => void importFile(f)}
                  importError={importError}
                  onDeleteMenu={() => void handleDeleteMenu(routedDoc.id)}
                  onBack={() => void handleBackToLibrary()}
                  publishing={{
                    status: activePublication,
                    loaded: activePublicationLoaded,
                    busy: publishBusy,
                    error: publishError,
                    inAccount: activeMenuOnServer,
                    accountCheckFailed: activeMenuAccountCheckFailed,
                    onRetryAccountCheck: retryAccountCheck,
                    liveDoc: liveDocMenuId === routedDoc.id ? liveDoc : null,
                    liveDocState: liveDocMenuId === routedDoc.id ? liveDocState : "idle",
                    onPublish: () => void handlePublish(),
                    onUnpublish: () => void handleUnpublish(),
                  }}
                  onPreviewOpen={() => void refreshPublication(routedDoc.id)}
                />
              )}
            </>
          )}
        </>
      )}

      {screen === "capture" && !shellReady && pages.length === 0 && result === null && (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-9 w-2/3 max-w-md" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {screen === "capture" && (shellReady || pages.length > 0 || result !== null) && (
        <CapturePage
          signedIn={signedIn}
          sessionPending={sessionPending}
          step={activeStep}
          phase={phase}
          pages={pages}
          fileError={fileError}
          addInputRef={addInputRef}
          replaceInputRef={replaceInputRef}
          replaceIndexRef={replaceIndexRef}
          resultRef={resultRef}
          onSelectFiles={selectFiles}
          onDemo={handleDemo}
          onAddPages={addPages}
          onReplacePageAt={replacePageAt}
          onRemovePage={removePage}
          onExtract={handleExtract}
          extractProgress={extractProgress}
          extractError={extractError}
          result={result}
          previewDoc={resultDoc}
          source={source}
          draftSave={draftSave}
          draftOnServer={resultDoc ? serverIds.has(resultDoc.id) : false}
          initialReviewCount={initialReviewCount}
          onClear={clearCapture}
          onEdit={() => void handleEditResult()}
          onResolveItem={handleResolveResultItem}
          onResolveAll={handleResolveAllResultItems}
          onUpdatePrice={handleUpdateResultPrice}
          onRenameTitle={handleRenameResultTitle}
          onPublish={
            source === "demo" || draftSave === "saved" ? () => void handleStartPublish() : undefined
          }
        />
      )}

      {screen === "editor" && !routedDoc && missingPublishMenuId && (
        <MissingDraftCard
          onOpenLibrary={() => navigate({ screen: "library" })}
          onStartFresh={() => navigate({ screen: "capture" })}
        />
      )}
      {screen === "editor" && !routedDoc && !missingPublishMenuId && sessionCheckGaveUp && (
        <section className="rounded-2xl border border-line-200 bg-surface-base p-6 text-center">
          <h1 className="font-medium text-ink-900">Checking your session…</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
            We couldn’t reach your account just now, so this menu hasn’t been opened. Your draft is
            still saved in this browser — nothing is lost.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={workspace.retrySession}
              className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => navigate({ screen: "library" })}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Back to My menus
            </button>
          </div>
        </section>
      )}
      {screen === "editor" && !routedDoc && !missingPublishMenuId && !sessionCheckGaveUp && (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Opening menu…</span>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
              <Skeleton className="mt-3 h-28" />
            </div>
            <div className="rounded-2xl border border-line-200 bg-surface-base p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-3/5" />
              <Skeleton className="mt-4 h-9" />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

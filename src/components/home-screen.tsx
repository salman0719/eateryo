"use client";

import { useEffect, useRef, useState } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { BrandBar } from "@/components/layout/brand-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { AssistantPage } from "@/components/pages/assistant-page";
import { CapturePage } from "@/components/pages/capture-page";
import { MenusPage } from "@/components/pages/menus-page";
import { OrdersPage } from "@/components/pages/orders-page";
import { SettingsPage } from "@/components/pages/settings-page";
import { TablesPage } from "@/components/pages/tables-page";
import { BookIcon, CameraIcon, ChecklistIcon, MoreIcon, ReceiptIcon } from "@/components/ui/icons";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { HeightReveal } from "@/components/ui/height-reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { ConflictBanner } from "@/components/menu-editor/conflict-banner";
import {
  LocalDraftsNotice,
  LocalDraftsOffer,
  type LocalDraftClaimNotice,
} from "@/components/menu-editor/local-drafts-banner";
import { MissingDraftCard } from "@/components/menu-editor/missing-draft-card";
import { MonitorToasts } from "@/components/orders/monitor-toasts";
import { NewOrdersBadge } from "@/components/orders/new-orders-badge";
import { OrderMonitorProvider, useOrderMonitor } from "@/features/orders/monitor";
import { MenuEditor, SaveState } from "@/components/menu-editor/menu-editor";
import { PublishWizard } from "@/components/menu-editor/publish-wizard";
import type {
  PreviewMenu,
  ReviewItemLocation,
  ReviewResolution,
} from "@/components/upload/extraction-result";
import type { PageImage } from "@/components/upload/image-preview";
import { extractedMenuToDocument } from "@/features/menu/convert";
import {
  downloadTextFile,
  menuFilename,
  menuToCsv,
  parseImportedMenu,
  serializeMenu,
} from "@/features/menu/import-export";
import {
  acceptItemUnpriced,
  confirmItemReviewed,
  createMenuDocument,
  defaultNewMenuTitle,
  hasAnyPrice,
  isItemFlagged,
  suggestRestaurantName,
  updateItem,
} from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import {
  cacheMenu,
  createMenu,
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
  deleteServerMenu,
  fetchCafeMenus,
  fetchServerMenu,
  SyncError,
  updateServerMenu,
} from "@/features/menus/sync";
import {
  fetchLiveMenuDoc,
  fetchPublication,
  publishMenu,
  unpublishMenu,
} from "@/features/publishing/client";
import { usePathname } from "next/navigation";

import type { PublicationStatus } from "@/features/publishing/schema";
import type { PublishSetupResult } from "@/features/publishing/setup-schema";
import { rememberPublishJourney } from "@/features/publishing/wizard-state";
import { authClient } from "@/lib/auth-client";
import {
  ExtractClientError,
  extractMenuFromFiles,
  type MenuExtractionResult,
} from "@/lib/extract-client";
import { validateImageBatch } from "@/lib/image-constraints";
import { PrepareImageError, prepareImageForUpload } from "@/lib/prepare-image";
import {
  availableSections,
  appRouteHref,
  moreSheetRows,
  parseAppRoute,
  phoneTabs,
  routeMenuId,
  sectionForScreen,
  shellColumnVisible,
  signOutLandingRoute,
  unresolvableMenuMessage,
  type AppRoute,
  type AppScreen,
  type AppSectionId,
  type EditorMode,
} from "@/features/navigation/routes";
import { useFeatureFlags } from "@/features/flags/client";
import { fetchLaunchStatus } from "@/features/launch/client";
import { cardsPrintedOnThisDevice, launchProgress } from "@/features/launch/progress";
import {
  accessCan,
  accessIsStaff,
  isPublishedOnlyAccess,
  menuAccessById,
  type MenuAccess,
} from "@/features/tenancy/access";
import { workspaceCan } from "@/features/tenancy/workspace";
import { WorkspaceProvider, useWorkspace } from "@/features/tenancy/workspace-context";
import { createRestaurant } from "@/features/tenancy/client";
import { moveLocalMenuToAccount, moveLocalMenusToAccount } from "@/features/menus/move-to-account";
import {
  clearDraftOrigin,
  decideHeal,
  getDraftOrigin,
  listDraftOrigins,
  menuContentHash,
  refreshDraftSync,
  stampClaimedMenus,
  stampDraftOrigin,
  visibleMenuIds,
  type DraftOrigin,
} from "@/features/menus/draft-origins";
import {
  accountReadState,
  decideLocalDraftClaimSurface,
  deriveClaimGate,
  dismissLocalDraftClaim,
  loadLocalDraftClaim,
  markLocalDraftsClaimed,
  resolveAutoClaimTarget,
  resumeBannerReady,
  type LocalDraftClaimStatus,
} from "@/features/menus/claim-local-drafts";
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
import { docForRoutedMenu } from "@/features/menus/routed-doc";

type Phase = "upload" | "ready" | "extracting" | "done";

/** Save status stays one word; `detail` says where the save went. */
function savedState(detail: string): SaveState {
  return { kind: "saved", message: "Saved", detail };
}

/** Content equality ignoring the save stamp (same rule the sync uses). */
function sameMenuContent(a: MenuDocument, b: MenuDocument): boolean {
  return JSON.stringify({ ...a, updatedAt: "" }) === JSON.stringify({ ...b, updatedAt: "" });
}

function stepIndex(phase: Phase, hasResult: boolean): number {
  if (hasResult || phase === "done") return 2;
  if (phase === "ready" || phase === "extracting") return 1;
  return 0;
}

/** Tells the monitor whether the board is open (opening it counts as seeing). */
function ViewingTracker({ viewing }: { viewing: boolean }) {
  const { setViewingBoard } = useOrderMonitor();
  useEffect(() => {
    setViewingBoard(viewing);
  }, [viewing, setViewingBoard]);
  return null;
}

/** New-order toasts above the tab bar; tapping opens the Orders tab. */
function MonitorToastStack({ onOpen }: { onOpen: () => void }) {
  const { toasts, dismissToast } = useOrderMonitor();
  return <MonitorToasts toasts={toasts} onOpen={onOpen} onDismiss={dismissToast} />;
}

/**
 * The phone tab bar's glyphs come from the shared icon set, never emoji. The
 * bar only ever carries the sections marked `phone: "bar"`; the other ids are
 * unreachable here and draw nothing.
 */
function PhoneTabIcon({ id }: { id: AppSectionId }) {
  switch (id) {
    case "capture":
      return <CameraIcon size={22} />;
    case "library":
      return <BookIcon size={22} />;
    case "orders":
      return <ReceiptIcon size={22} />;
    default:
      return null;
  }
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
  // (this shell included) asks about the same café.
  return (
    <WorkspaceProvider>
      <HomeShell initialRoute={initialRoute} />
    </WorkspaceProvider>
  );
}

function HomeShell({ initialRoute }: { initialRoute: AppRoute }) {
  // The URL is the source of truth for the main screen and selected menu.
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const { confirm, dialog } = useConfirm();
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
  /** A publish URL whose draft resolves nowhere: hold the URL with an
   * explainer card instead of bouncing to the library. Cleared on any
   * navigation; re-set if the same dead URL is opened again. */
  const [missingPublishMenuId, setMissingPublishMenuId] = useState<string | null>(null);
  const routeRef = useRef<AppRoute>(route);
  const navigationReadyRef = useRef(false);
  const openedRouteMenuRef = useRef<string | null>(null);
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);
  const navigateToRef = useRef<
    ((next: AppRoute, replace?: boolean, flushCurrent?: boolean) => void) | null
  >(null);
  const openDocRef = useRef<
    | ((
        doc: MenuDocument,
        image: Blob | null,
        updateRoute?: boolean,
        accessHint?: MenuAccess
      ) => Promise<void>)
    | null
  >(null);
  const activeDocIdRef = useRef<string | null>(null);
  /** Previous session state, so only a real sign-out (not a first load) clears. */
  const wasSignedInRef = useRef(false);

  function navigateTo(next: AppRoute, replace = false, flushCurrent = true) {
    const previousMenuId = routeMenuId(routeRef.current);
    if (flushCurrent && previousMenuId && previousMenuId !== routeMenuId(next)) {
      void flushSaveRef.current?.();
    }
    const href = appRouteHref(next);
    if (
      typeof window !== "undefined" &&
      window.location.pathname + window.location.search !== href
    ) {
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    }
    routeRef.current = next;
    setRoute(next);
    setMissingPublishMenuId(null);
    if (typeof window !== "undefined") navigationReadyRef.current = true;
  }

  // The visible screen must follow every URL change, however it happened:
  // tab clicks and in-app links write the History API directly (native
  // history is integrated with Next's router, so each path change surfaces
  // in `usePathname`), and back/forward fires `popstate`. Subscribing to the
  // pathname as well matters because a `<Link>` push whose target is the
  // page component already mounted swaps nothing — without this sync the
  // URL moves while the screen stays on the old one.
  const pathname = usePathname();
  useEffect(() => {
    const syncFromLocation = () => {
      const next = parseAppRoute(window.location.href);
      const previousMenuId = routeMenuId(routeRef.current);
      if (previousMenuId && previousMenuId !== routeMenuId(next)) {
        void flushSaveRef.current?.();
      }
      routeRef.current = next;
      setRoute(next);
      navigationReadyRef.current = true;
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [pathname]);

  // Signed out is capture-only (plus the library working set and the editor
  // for anonymous drafts): orders/tables/settings/assistant need an account,
  // so a signed-out visitor who lands on one (typed URL, old bookmark)
  // goes back to capture. Runs every render by design; the guard goes
  // quiet once the screen moves on, and stays inert while the session read is
  // unanswered (015): unknown is not signed out.
  useEffect(() => {
    if (sessionState === "signed-out") {
      const guarded = routeRef.current.screen;
      if (
        guarded === "assistant" ||
        guarded === "orders" ||
        guarded === "tables" ||
        guarded === "settings"
      ) {
        navigateTo({ screen: "capture" }, true);
      }
    }
  });

  const [pages, setPages] = useState<PageImage[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [extracted, setExtracted] = useState<MenuExtractionResult | null>(null);
  /** Canonical form of the current result, for the phone-framed first look. */
  const [resultDoc, setResultDoc] = useState<MenuDocument | null>(null);
  /** Real progress for the extraction wait; null outside an extraction. */
  const [extractProgress, setExtractProgress] = useState<{
    pageCount: number;
    preparedPages: number;
    requestStartedAt: number | null;
  } | null>(null);
  /** Draft persisted automatically after a successful AI extraction. */
  const [draftSave, setDraftSave] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  /** Flagged count when the current extraction landed; drives the "N of M
   * checked" progress on the result screen. Reset with the capture. */
  const [initialReviewCount, setInitialReviewCount] = useState<number | null>(null);
  const draftDocRef = useRef<MenuDocument | null>(null);
  /** Guards autosave state against a newer extraction or a reset. */
  const draftTokenRef = useRef(0);
  const [demoDoc, setDemoDoc] = useState<MenuDocument | null>(null);
  const [source, setSource] = useState<"ai" | "demo">("ai");
  const [extractError, setExtractError] = useState<ExtractClientError | null>(null);

  // Library + editor state.
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  /** True until the first library read settles (skeleton rows, not the empty state). */
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [storageDown, setStorageDown] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<MenuDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(
    savedState("Saved in this browser. Sign in to use this menu on other devices.")
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  /** Preview URLs currently shown for `pages` (revoked on swap and unmount). */
  const liveUrlsRef = useRef<string[]>([]);
  /**
   * Mirror of `editorImageUrl`: the route effect must know whether the open
   * menu's source image is currently shown (ref read — no extra effect runs).
   */
  const editorImageUrlRef = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<MenuDocument | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageDownRef = useRef(false);

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
  const restaurantSettledFor = workspace.settledFor;
  const restaurantFailedFor = workspace.failedFor;
  const ownedRestaurantsForAccount = workspace.owned;
  const accountAccessPending = signedIn && workspace.pending;
  const restaurantsLoading = signedIn && workspace.pending;
  const switchWorkspace = workspace.switchTo;
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
  /** The server updatedAt the open menu was last synced at; null = don't push. */
  const serverBaseRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState<{ serverUpdatedAt: string | null } | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const conflictRef = useRef<{ serverUpdatedAt: string | null } | null>(null);
  /** Ids of the caller's menus that exist on the server (chips + operations). */
  const serverIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [serverIds, setServerIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * The café each account menu belongs to, keyed by menu id. A browser-only
   * draft has no entry — it belongs to no café until it is moved. The
   * summaries already carry this, so the library can be scoped without a
   * second request.
   */
  const [menuRestaurantById, setMenuRestaurantById] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  /** Ids of account menus where the caller is staff only (view, never edit). */
  /**
   * Server-resolved access for each menu, keyed by id. A missing id is the
   * unanswered state — never "no access" and never "owner". `"local"` is a
   * browser-only menu the caller owns; `"none"` is a row the server refused,
   * whose cached copy must not be rendered.
   */
  const menuAccessRef = useRef<ReadonlyMap<string, MenuAccess>>(new Map());
  const [menuAccess, setMenuAccess] = useState<ReadonlyMap<string, MenuAccess>>(new Map());
  /** Which account the server menu ids belong to; null until a merge settles. */
  const [serverMenusFor, setServerMenusFor] = useState<string | null>(null);
  /** Which account's server menu read failed (same third state, menus). */
  const [serverMenusReadFailedFor, setServerMenusReadFailedFor] = useState<string | null>(null);
  /**
   * Which account's server menu list has *finished* being read, however it
   * ended. The chip column waits for this (001): before it lands, an empty id
   * set means "not asked yet", never "this browser only".
   */
  const [serverMenusReadFor, setServerMenusReadFor] = useState<string | null>(null);
  /**
   * The same marker as a ref: the save status and the publish gate decide in
   * async code that finishes after an await (003).
   */
  const accountMenusSettledRef = useRef<string | null>(null);
  /** The same failure marker as a ref: the save status decides after awaits. */
  const accountMenusReadFailedRef = useRef<string | null>(null);
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
  /** Device-local ownership stamps (which account each draft belongs to). */
  const [originList, setOriginList] = useState<DraftOrigin[]>([]);
  /** The answer just given here; the stored per-account value is the fallback. */
  const [claimAnswer, setClaimAnswer] = useState<{
    accountKey: string;
    status: LocalDraftClaimStatus;
  } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<LocalDraftClaimNotice | null>(null);
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
   * The first settled non-editor look at this account decides whether the
   * automatic import runs. Later local menus (a demo saved mid-session) are
   * never swept into an account behind the owner's back.
   */
  const claimEvaluatedRef = useRef<string | null>(null);
  /** Deduplicates concurrent account merges. */
  const mergeRef = useRef<Promise<void> | null>(null);

  // Publishing (Step 9): the open menu's public-link state, loaded on open
  // and refreshed whenever the preview is shown (that is when an owner looks
  // for "are my changes live?").
  const [publication, setPublication] = useState<PublicationStatus | null>(null);
  /** Which menu the loaded publication belongs to (guards against leaks). */
  const [publicationMenuId, setPublicationMenuId] = useState<string | null>(null);
  const [publicationLoaded, setPublicationLoaded] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  /**
   * The snapshot diners see now, read only while the draft is ahead of it.
   * The publish panel diffs it against the draft so the owner sees what
   * "Publish changes" actually changes.
   */
  const [liveDoc, setLiveDoc] = useState<MenuDocument | null>(null);
  const [liveDocMenuId, setLiveDocMenuId] = useState<string | null>(null);
  const [liveDocState, setLiveDocState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    signedInRef.current = signedIn;
    sessionStateRef.current = sessionState;
    accountKeyRef.current = accountKey;
  }, [signedIn, sessionState, accountKey]);

  // The save status and the publish gate decide in async code that finishes
  // after an await, so the failed read travels with the other refs (003, 016).
  useEffect(() => {
    accountMenusReadFailedRef.current = serverMenusReadFailedFor;
  }, [serverMenusReadFailedFor]);

  // Display derives from the canonical docs (which carry confirmations),
  // falling back to the raw extraction only for the empty state.
  const result: PreviewMenu | null = resultDoc ?? demoDoc ?? extracted?.menu ?? null;

  useEffect(() => {
    return () => {
      liveUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  flushSaveRef.current = flushSave;
  navigateToRef.current = navigateTo;
  openDocRef.current = openDoc;
  activeDocIdRef.current = activeDoc?.id ?? null;
  editorImageUrlRef.current = editorImageUrl;

  useEffect(() => {
    if (!navigationReadyRef.current || !routeMenuId(route) || sessionState === "unknown") return;
    const menuId = routeMenuId(route);
    if (!menuId) return;
    if (activeDocIdRef.current === menuId) {
      openedRouteMenuRef.current = menuId;
      // Fast path: the doc is already in memory (editor mode switches, and
      // returns to a menu that was left open). "Back to library" releases
      // the source image URL while keeping the doc, so returning through
      // this path must restore the image — otherwise the editor reopens
      // without it. Only the image is re-read; the doc is not.
      if (editorImageUrlRef.current) return;
      let imageCancelled = false;
      void (async () => {
        try {
          const stored = await getImage(menuId);
          if (imageCancelled || activeDocIdRef.current !== menuId) return;
          setEditorImage(stored?.blob ? URL.createObjectURL(stored.blob) : null);
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
            setLibraryError(menuOpenBlockedMessage(access.reason));
            openedRouteMenuRef.current = null;
            navigateToRef.current?.({ screen: "library" }, true);
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
        if (!cancelled) await openDocRef.current?.(doc, imageBlob, false, accessHint);
      } catch {
        if (cancelled) return;
        openedRouteMenuRef.current = null;
        // A dead publish link holds its URL with an explainer card — the
        // draft is in another browser, and the library can't show that.
        if (route.screen === "editor" && route.mode === "publish") {
          setMissingPublishMenuId(menuId);
          return;
        }
        setLibraryError(unresolvableMenuMessage(route));
        navigateToRef.current?.({ screen: "library" }, true);
      }
    })();

    return () => {
      cancelled = true;
      if (openedRouteMenuRef.current === menuId) openedRouteMenuRef.current = null;
    };
  }, [route, sessionState, signedIn, accountKey, serverMenusReadFor]);

  useEffect(() => {
    const wasSignedIn = wasSignedInRef.current;
    wasSignedInRef.current = signedIn;

    if (!signedIn) {
      // Sign-out is a privacy boundary. An open editor or a result on
      // Capture can hold an account menu, so a real session end dismisses
      // both and lands on Capture. Nothing is deleted: anonymous drafts
      // remain in My menus, and the landed screen is the signed-out home.
      const landing = signOutLandingRoute({ wasSignedIn, signedIn });
      if (landing) {
        const openDoc = docRef.current;
        if (openDoc) {
          // Release the open document before saving it. Pending account
          // work (sync, publication, the route opener) checks docRef and
          // bails once it is null, so nothing can reopen the editor. The
          // direct save still keeps the latest local edits.
          docRef.current = null;
          lastSavedRef.current = null;
          serverBaseRef.current = null;
          conflictRef.current = null;
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          if (!storageDownRef.current) {
            void saveMenu(openDoc).catch(() => undefined);
          }
        }
        setActiveDoc(null);
        setEditorImage(null);
        setConflict(null);
        setConflictError(null);
        setPublication(null);
        setPublicationMenuId(null);
        setPublicationLoaded(false);
        setPublishError(null);
        resetLiveDoc();
        if (resultDoc !== null || pages.length > 0) applySelection([]);
        navigateTo(landing, true, false);
      }
      replaceServerIds(new Set());
      replaceMenuAccess(new Map());
      setMenuRestaurantById(new Map());
      // The ids and the read that produced them reset together (001): a stale
      // "settled" marker over an empty id set would let the next sign-in paint
      // the same false chip.
      setServerMenusFor(null);
      setServerMenusReadFailedFor(null);
      setServerMenusReadFor(null);
      accountMenusSettledRef.current = null;
      // State is compared with accountKey when read, so a stale value from
      // the previous session can never authorise an import for this one.
      claimEvaluatedRef.current = null;
      return;
    }
    // Sign-in: merge account menus into the library, heal interrupted work
    // from closed menus, and reconcile a menu that was already open. A menu
    // that was never moved to the account stays local-only (serverBaseRef
    // stays null), so this cannot loop.
    void refreshLibrary();
    void healStampedDrafts();
    const doc = docRef.current;
    if (doc && serverBaseRef.current === null && !conflictRef.current) {
      void syncWithAccount(doc);
    }
    if (doc) void refreshPublication(doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  /** Which account+café the shell has already read this session. */
  const mergedCafeRef = useRef<string | null>(null);

  /**
   * Café-keyed read: the library is one café's list, so a different membership
   * starts from a different read, and an account with no café settles empty
   * instead of waiting forever. Ids and access answers from the previous café
   * do not describe this one, so they are dropped before the new read.
   */
  useEffect(() => {
    if (!signedIn || !accountKey) {
      mergedCafeRef.current = null;
      return;
    }
    if (!activeWorkspace) {
      if (workspace.pending) return;
      mergedCafeRef.current = `${accountKey}:none`;
      // Deferred like the other account reads: the effect must not set state
      // synchronously while rendering the frame that decided it.
      void Promise.resolve().then(() => {
        replaceServerIds(new Set());
        replaceMenuAccess(new Map());
        setServerMenusFor(accountKey);
        setServerMenusReadFailedFor(null);
        setServerMenusReadFor(accountKey);
        accountMenusSettledRef.current = accountKey;
      });
      return;
    }
    const key = `${accountKey}:${activeWorkspace.restaurantId}`;
    if (mergedCafeRef.current === key) return;
    mergedCafeRef.current = key;
    // Keep the browser-only answers: a local draft is the caller's own row and
    // belongs to no café, so it must not become read-only on a switch.
    replaceServerIds(new Set());
    replaceMenuAccess(
      new Map([...menuAccessRef.current].filter(([, access]) => access === "local"))
    );
    setServerMenusFor(null);
    setServerMenusReadFor(null);
    setServerMenusReadFailedFor(null);
    accountMenusSettledRef.current = null;
    // Chain onto a merge left over from the previous café instead of letting
    // the dedupe swallow this one (001).
    void (mergeRef.current ?? Promise.resolve()).then(() => mergeAccountMenus());
  }, [accountKey, activeWorkspace, signedIn, workspace.pending]);

  function replaceServerIds(next: ReadonlySet<string>) {
    serverIdsRef.current = next;
    setServerIds(next);
  }

  function replaceMenuAccess(next: ReadonlyMap<string, MenuAccess>) {
    menuAccessRef.current = next;
    setMenuAccess(next);
  }

  /**
   * Which café a menu belongs to, learned from the server's own answer. It
   * follows the switcher across cafés (a deep link can open another café's
   * menu) and is never used to filter the library — the café-keyed read
   * already returns one café's rows.
   */
  function rememberMenuCafe(menuId: string, restaurantId: string) {
    setMenuRestaurantById((current) =>
      current.get(menuId) === restaurantId ? current : new Map(current).set(menuId, restaurantId)
    );
  }

  function rememberMenuCafes(menus: { id: string; restaurantId: string }[]) {
    setMenuRestaurantById((current) => {
      const next = new Map(current);
      for (const menu of menus) next.set(menu.id, menu.restaurantId);
      return next;
    });
  }

  /** Record one menu's access answer without touching the rest. */
  function setMenuAccessFor(id: string, access: MenuAccess) {
    if (menuAccessRef.current.get(id) === access) return;
    const next = new Map(menuAccessRef.current);
    next.set(id, access);
    replaceMenuAccess(next);
  }

  function addServerId(id: string) {
    if (serverIdsRef.current.has(id)) return;
    const next = new Set(serverIdsRef.current);
    next.add(id);
    replaceServerIds(next);
  }

  function removeServerId(id: string) {
    if (!serverIdsRef.current.has(id)) return;
    const next = new Set(serverIdsRef.current);
    next.delete(id);
    replaceServerIds(next);
  }

  async function refreshLibrary() {
    try {
      setMenus(await listMenus());
      setOriginList(await listDraftOrigins());
      setStorageDown(false);
      storageDownRef.current = false;
    } catch (error) {
      setStorageDown(true);
      storageDownRef.current = true;
      if (error instanceof StorageError) setLibraryError(error.message);
    } finally {
      setLibraryLoading(false);
    }
  }

  /**
   * Retry the account's menu read after a failure (016). The markers drop
   * back to "not read yet" first, so the surfaces return to their
   * placeholders instead of announcing an answer that has not arrived.
   */
  function handleRetryAccountCheck() {
    if (!accountKey) return;
    setServerMenusReadFailedFor(null);
    setServerMenusReadFor(null);
    accountMenusSettledRef.current = null;
    void mergeAccountMenus();
  }

  /**
   * Merge the account's menus into the local library (signed in only). A
   * menu that exists only on the server — moved from another device — is
   * downloaded and cached locally once, so the library lists and opens it
   * anywhere; afterwards it behaves like any local menu, reconciled with
   * the server revision on open. Best-effort: offline or a server DB that
   * is unavailable leaves the local library standing alone.
   */
  async function mergeAccountMenus() {
    if (!signedInRef.current || mergeRef.current) return;
    // Café-keyed: the library is one café's list, so the read names the café.
    // Until it resolves the keyed effect re-runs; an account with no café is
    // settled there, never here as an empty "read".
    const restaurantId = activeRestaurantIdRef.current;
    if (!restaurantId) return;
    const run = (async () => {
      try {
        const { menus: serverMenus } = await fetchCafeMenus(restaurantId);
        replaceServerIds(new Set(serverMenus.map((menu) => menu.id)));
        rememberMenuCafes(serverMenus);
        // The claim offer waits for this: an empty set is only trustworthy
        // once the account has actually been read.
        if (signedInRef.current) {
          setServerMenusFor(accountKey);
          setServerMenusReadFailedFor(null);
        }
        // One answer, no second role lookup: each summary already carries the
        // caller's capabilities. A browser-only menu keeps its local answer
        // while the server list has nothing to say about it.
        const accessById = new Map<string, MenuAccess>(menuAccessById(serverMenus));
        for (const [id, access] of menuAccessRef.current) {
          if (access === "local" && !accessById.has(id)) accessById.set(id, "local");
        }
        replaceMenuAccess(accessById);
        const localIds = new Set((await listMenus()).map((menu) => menu.id));
        let cachedAny = false;
        let originsChanged = false;
        for (const summary of serverMenus) {
          // A member without the draft grant must never open a cached draft:
          // replace it with the live snapshot before it can be read. This is
          // the cache half of the server-side projection (the API already
          // refuses to send the draft).
          if (!summary.access.capabilities.includes("menus.read_draft")) {
            try {
              const full = await fetchServerMenu(summary.id);
              await cacheMenu({ ...full.doc, updatedAt: full.updatedAt });
              cachedAny = true;
            } catch {
              // One unreadable row never blocks the rest; the next refresh
              // retries it.
            }
            continue;
          }
          if (localIds.has(summary.id)) {
            // Backfill: this row is provably the account's (same id on the
            // server) but was never marked — signed out, it would resurface
            // as an anonymous draft. The agreed revision comes from the
            // server, so a later return heals instead of conflicting.
            // Staff rows and someone else's cache are never touched.
            if (!accessCan(menuAccessRef.current.get(summary.id), "menus.write")) continue;
            const backfillActor = accountKeyRef.current;
            if (!backfillActor) continue;
            try {
              const origin = await getDraftOrigin(summary.id).catch(() => undefined);
              if (origin) continue;
              if (!signedInRef.current) continue;
              const full = await fetchServerMenu(summary.id);
              if (!signedInRef.current) continue;
              await refreshDraftSync(
                summary.id,
                backfillActor,
                full.updatedAt,
                menuContentHash(full.doc)
              );
              originsChanged = true;
            } catch {
              // One unreadable row never blocks the rest; the next sign-in
              // retries it.
            }
            continue;
          }
          try {
            const full = await fetchServerMenu(summary.id);
            await cacheMenu(full.doc);
            const mergeActor = accountKeyRef.current;
            if (mergeActor)
              await refreshDraftSync(
                summary.id,
                mergeActor,
                full.updatedAt,
                menuContentHash(full.doc)
              );
            cachedAny = true;
          } catch {
            // One failed download never blocks the rest; the menu stays in
            // the account and the next refresh retries it.
          }
        }
        if (cachedAny) setMenus(await listMenus());
        if (originsChanged) setOriginList(await listDraftOrigins());
      } catch {
        // Signed out mid-flight, offline, or the server DB is unavailable:
        // the local library stands alone. Remember that the read failed so
        // the claim gate can settle as unknown instead of waiting forever.
        mergedCafeRef.current = null;
        if (signedInRef.current && accountKeyRef.current) {
          setServerMenusReadFailedFor(accountKeyRef.current);
        }
      } finally {
        // Settled either way, so the library may stop skeletoning. On a failed
        // read it then says nothing about membership rather than claiming
        // "this browser only" (001).
        if (signedInRef.current && accountKeyRef.current) {
          setServerMenusReadFor(accountKeyRef.current);
          accountMenusSettledRef.current = accountKeyRef.current;
        }
      }
    })();
    mergeRef.current = run;
    try {
      await run;
    } finally {
      mergeRef.current = null;
    }
  }

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

  // --- Autosave -----------------------------------------------------------

  async function doSave() {
    const doc = docRef.current;
    if (!doc || storageDownRef.current) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedRef.current) {
      setSaveState(storageSaveState(doc.id));
      return;
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
      setMenus(await listMenus());
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

  function setEditorImage(url: string | null) {
    setEditorImageUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  }

  async function openDoc(
    doc: MenuDocument,
    imageBlob: Blob | null,
    updateRoute = true,
    accessHint?: MenuAccess
  ) {
    setPublication(null);
    setPublicationMenuId(null);
    setPublicationLoaded(false);
    setPublishError(null);
    resetLiveDoc();
    void refreshPublication(doc.id);
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
    if (updateRoute) navigateTo({ screen: "editor", menuId: doc.id, mode: "edit" });
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

  // --- Library actions ----------------------------------------------------

  function handleOpenMenu(id: string) {
    setLibraryError(null);
    navigateTo({ screen: "editor", menuId: id, mode: "edit" });
  }

  async function handleNewMenu(suggestedTitle?: string) {
    setLibraryError(null);
    // Q2: never gate on a name — blank menus arrive titled ("Main Menu"
    // first, honest numbering after) and rename inline in the editor.
    const fallback = defaultNewMenuTitle(menus.map((menu) => menu.title));
    const title = suggestedTitle?.trim() ? suggestedTitle.trim() : fallback;
    const doc = storageDownRef.current
      ? createMenuDocument({ title })
      : await createMenu(title).catch((error: unknown) => {
          setLibraryError(
            error instanceof StorageError ? error.message : "Could not create a menu."
          );
          return null;
        });
    if (!doc) return;
    const newMenuActor = signedInRef.current ? accountKeyRef.current : null;
    if (newMenuActor) await stampDraftOrigin(doc.id, newMenuActor, "");
    if (!storageDownRef.current) await refreshLibrary();
    await openDoc(doc, null, true, "local");
  }

  async function handleRenameMenu(id: string, title: string) {
    const access = menuAccessRef.current.get(id);
    if (signedInRef.current && access !== "local" && !accessCan(access, "menus.write")) {
      setLibraryError("Only someone with menu access can rename this menu.");
      return;
    }
    try {
      const renamed = await renameMenu(id, title);
      const renameActor = signedInRef.current ? accountKeyRef.current : null;
      if (renameActor && accessCan(menuAccessRef.current.get(id), "menus.write")) {
        // Keep the existing baseline when this menu is not open: the
        // editor's baseline belongs to another document.
        await stampDraftOrigin(
          id,
          renameActor,
          docRef.current?.id === id ? (serverBaseRef.current ?? "") : ""
        );
      }
      if (signedInRef.current && serverIdsRef.current.has(id)) {
        await pushRenameToAccount(renamed);
      }
      await refreshLibrary();
      if (docRef.current?.id === id) {
        docRef.current = renamed;
        lastSavedRef.current = JSON.stringify(renamed);
        setActiveDoc(renamed);
      }
    } catch (error) {
      setLibraryError(
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
        if (docRef.current?.id === renamed.id) serverBaseRef.current = pushed.updatedAt;
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
          setLibraryError(
            "Renamed in this browser — it changed on your other device. Open the menu to reconcile."
          );
        } else if (error instanceof SyncError && error.code === "forbidden") {
          setLibraryError(
            "Renamed in this browser — only the restaurant owner can rename it on your account."
          );
        } else if (error instanceof SyncError && error.code === "unauthorized") {
          setLibraryError("Renamed in this browser — sign in again to rename it on your account.");
        } else {
          setLibraryError(
            "Renamed in this browser — the change could not be saved to your account. Try again when online."
          );
        }
      }
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(renamed.id);
        return;
      }
      setLibraryError(
        "Renamed in this browser — your account could not be reached. Try again when online."
      );
    }
  }

  /**
   * Add one browser-only menu to an owned restaurant. The library row shows
   * the returned message on failure; success marks the row as on the account
   * right away, then reconciles with the server list.
   */
  async function handleMoveMenuToAccount(
    menuId: string,
    restaurantId: string
  ): Promise<string | null> {
    const title = visibleMenus.find((menu) => menu.id === menuId)?.title ?? "That menu";
    const outcome = await moveLocalMenuToAccount(restaurantId, menuId);
    if (outcome.status === "failed") {
      return `“${title}” could not be added — ${outcome.reason}`;
    }
    addServerId(menuId);
    const moveActor = accountKeyRef.current;
    if (moveActor) await stampClaimedMenus([menuId], moveActor, (id) => getMenu(id));
    await mergeAccountMenus();
    return null;
  }

  /**
   * Copy the rest of this browser's menus into one owned restaurant. Shared
   * by the one-click offer, the automatic import for a brand-new account,
   * and the import that follows the wizard creating the account's first
   * café. The local copies stay put; the notice reports per-batch totals.
   */
  async function runLocalDraftClaim(restaurantId: string, restaurantName: string) {
    setClaimBusy(true);
    setClaimError(null);
    try {
      // Only the visible browser-only rows move: hidden rows belong to
      // another session and are never swept into this account.
      const report = await moveLocalMenusToAccount(
        restaurantId,
        localOnly.map((menu) => menu.id)
      );
      [...report.imported, ...report.skipped].forEach((id) => addServerId(id));
      // Claimed rows are provably the account's copies: stamp them so a
      // later sign-out hides them instead of showing stale doppelgängers.
      if (accountKey) {
        await stampClaimedMenus([...report.imported, ...report.skipped], accountKey, (id) =>
          getMenu(id)
        );
      }
      // The claim may have run while a draft was open (signing in inside
      // the publish wizard). The editor still holds a null baseline for
      // that row, so the next save would stay local and fork the revision
      // just created. Reconcile the open row to the agreed revision instead.
      const openId = docRef.current?.id ?? null;
      const openClaimed =
        openId !== null && (report.imported.includes(openId) || report.skipped.includes(openId));
      if (openClaimed && openId !== null && accountKey) {
        try {
          const server = await fetchServerMenu(openId);
          if (docRef.current?.id === openId) {
            serverBaseRef.current = server.updatedAt;
            await refreshDraftSync(
              openId,
              accountKey,
              server.updatedAt,
              menuContentHash(server.doc)
            );
            setOriginList(await listDraftOrigins());
            setSaveState(savedState("Saved to your account."));
          }
        } catch {
          // The row is imported and stamped; the next open reconciles the
          // baseline. Never fail the claim over it.
        }
      }
      setClaimNotice({
        imported: report.imported.length,
        failed: report.failed.length,
        restaurantName,
      });
      if (accountKey) {
        markLocalDraftsClaimed(accountKey);
        setClaimAnswer({ accountKey, status: "done" });
      }
      await refreshLibrary();
      void mergeAccountMenus();
    } catch {
      setClaimError(
        "We couldn't read the menus saved in this browser. They are still here — try again from My menus."
      );
    } finally {
      setClaimBusy(false);
    }
  }

  /**
   * An account with no menus adopts this browser's drafts in one go. Where
   * they land is the account's own café when it has one — an empty café is
   * still *its* café — and only an account that owns none gets one created,
   * named from the menu titles rather than a placeholder the owner cannot
   * recognise. Reusing is what stops a retried claim from minting a second
   * café next to the first.
   */
  async function handleAutoClaim(titles: string[]) {
    if (!accountKey) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const target = resolveAutoClaimTarget(ownedRestaurantsForAccount, titles);
      if (target.kind === "reuse") {
        await runLocalDraftClaim(target.restaurantId, target.restaurantName);
        return;
      }
      const created = await createRestaurant(target.name);
      workspace.addRestaurant(created);
      await runLocalDraftClaim(created.id, created.name);
    } catch {
      setClaimError(
        "We couldn't set up your café automatically. Import your menus from My menus when you're ready."
      );
    } finally {
      setClaimBusy(false);
    }
  }

  function handleClaimAdd(restaurantId: string) {
    const restaurant = ownedRestaurantsForAccount.find((item) => item.id === restaurantId);
    if (!restaurant) return;
    void runLocalDraftClaim(restaurant.id, restaurant.name);
  }

  function handleDismissClaim() {
    if (!accountKey) return;
    dismissLocalDraftClaim(accountKey);
    setClaimAnswer({ accountKey, status: "dismissed" });
  }

  function resetLiveDoc() {
    setLiveDoc(null);
    setLiveDocMenuId(null);
    setLiveDocState("idle");
  }

  /**
   * Read the live snapshot, but only while the draft is ahead of it: with no
   * unpublished changes there is nothing to compare, and a paused or
   * never-published menu has no serving version at all.
   */
  async function refreshLiveDoc(menuId: string, status: PublicationStatus | null) {
    if (!status?.isLive || !status.hasUnpublishedChanges) {
      resetLiveDoc();
      return;
    }
    setLiveDocMenuId(menuId);
    setLiveDocState("loading");
    try {
      const doc = await fetchLiveMenuDoc(menuId);
      if (docRef.current?.id !== menuId) return;
      setLiveDoc(doc);
      setLiveDocState("ready");
    } catch (error) {
      if (docRef.current?.id !== menuId) return;
      if (error instanceof SyncError && error.code === "not_found") {
        setLiveDoc(null);
        setLiveDocState("ready");
        return;
      }
      setLiveDoc(null);
      setLiveDocState("error");
    }
  }

  /** Load the open menu's publication state (signed in only). */
  async function refreshPublication(menuId: string) {
    if (!signedInRef.current) {
      setPublication(null);
      setPublicationMenuId(null);
      setPublicationLoaded(false);
      resetLiveDoc();
      return;
    }
    setPublicationMenuId(menuId);
    try {
      const status = await fetchPublication(menuId);
      if (docRef.current?.id !== menuId) return;
      setPublication(status);
      setPublishError(null);
      void refreshLiveDoc(menuId, status);
    } catch (error) {
      if (docRef.current?.id !== menuId) return;
      if (error instanceof SyncError && error.code === "not_found") {
        setPublication(null);
      } else {
        setPublishError("Could not check the menu’s status. Try again in a moment.");
      }
      resetLiveDoc();
    } finally {
      if (docRef.current?.id === menuId) setPublicationLoaded(true);
    }
  }

  function publishErrorMessage(error: unknown): string {
    if (error instanceof SyncError) {
      switch (error.code) {
        case "unauthorized":
          return "Sign in again to publish this menu.";
        case "forbidden":
          return "Only the restaurant owner can publish this menu.";
        case "not_found":
          return "This menu is no longer in your account. Open it again to reconcile.";
        case "slug_taken":
          return "That link is already used by another menu at this café — pick another link name.";
        case "not_published":
          return "This menu is not published.";
        case "invalid":
          return error.message;
        default:
          return "Could not reach the server. Try again when you are online.";
      }
    }
    return "Something went wrong. Your edits are safe in this browser.";
  }

  /**
   * Publish (or publish changes): flush the pending save first so the
   * snapshot is of what the owner just saw, never of a stale draft.
   */
  async function handlePublish() {
    const doc = docRef.current;
    if (!doc) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      await flushSave();
      // An unread account list is not an answer, so ask this menu's own
      // endpoint rather than refusing on an empty set (003). Only a definite
      // "no such menu" refuses; an unreachable server is left to the publish
      // call, whose errors are already honest.
      let onAccount = serverIdsRef.current.has(doc.id);
      if (
        !onAccount &&
        signedInRef.current &&
        accountMenusSettledRef.current !== accountKeyRef.current
      ) {
        onAccount = await fetchServerMenu(doc.id).then(
          () => true,
          (error: unknown) => !(error instanceof SyncError && error.code === "not_found")
        );
        if (onAccount) addServerId(doc.id);
      }
      if (!onAccount) {
        setPublishError("Add this menu to your account first, then publish it.");
        return;
      }
      const status = await publishMenu(doc.id);
      setPublication(status);
      setPublicationLoaded(true);
      // Nothing is unpublished any more, so there is nothing left to compare.
      void refreshLiveDoc(doc.id, status);
    } catch (error) {
      setPublishError(publishErrorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleUnpublish() {
    const doc = docRef.current;
    if (!doc) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      setPublication(await unpublishMenu(doc.id));
    } catch (error) {
      setPublishError(publishErrorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }

  /**
   * The wizard published (or attached) this menu. Make the shell agree with
   * the server immediately: the library chip, the publication panel and the
   * next save's conflict baseline.
   */
  function handleWizardPublished(result: PublishSetupResult) {
    const menuId = result.publication.menuId;
    addServerId(menuId);
    setPublication(result.publication);
    setPublicationMenuId(menuId);
    setPublicationLoaded(true);
    setPublishError(null);
    resetLiveDoc();
    void (async () => {
      try {
        const server = await fetchServerMenu(menuId);
        if (docRef.current?.id === menuId) serverBaseRef.current = server.updatedAt;
        // The wizard is how onboarding menus reach the account. Stamp the
        // agreed revision so this row stays the account's — signed out, it
        // must never resurface as an anonymous draft.
        const publishActor = accountKeyRef.current;
        if (publishActor) {
          await refreshDraftSync(
            menuId,
            publishActor,
            server.updatedAt,
            menuContentHash(server.doc)
          );
          setOriginList(await listDraftOrigins());
        }
      } catch {
        // The next editor open reconciles the baseline; publishing already
        // succeeded, so this must not surface as a failure.
      }
    })();
    void mergeAccountMenus();
    void refreshLibrary();
    // Auto-import happens at sign-in only. Publishing never sweeps the
    // browser: anything left over stays put for the offer/manual path.
    // The published menu may be the capture draft: once it has a link,
    // Capture goes back to a fresh upload instead of showing the old draft
    // as if it were still being worked on. Other menus leave capture alone.
    if (menuId === draftDocRef.current?.id || menuId === demoDoc?.id) {
      clearCapture();
    }
  }

  async function handleDeleteMenu(id: string) {
    const access = menuAccessRef.current.get(id);
    if (signedInRef.current && access !== "local" && !accessCan(access, "menus.write")) {
      setLibraryError("Only someone with menu access can delete this menu.");
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
      if (docRef.current?.id === id) {
        docRef.current = null;
        lastSavedRef.current = null;
        serverBaseRef.current = null;
        conflictRef.current = null;
        setConflict(null);
        setActiveDoc(null);
        setEditorImage(null);
      }
      setPublication(null);
      setPublicationMenuId(null);
      setPublicationLoaded(false);
      setPublishError(null);
      resetLiveDoc();
      await refreshLibrary();
      if (accountNote) setLibraryError(accountNote);
      navigateTo({ screen: "library" }, false, false);
    } catch (error) {
      setLibraryError(
        error instanceof StorageError ? error.message : "Could not delete that menu."
      );
    }
  }

  async function handleBackToLibrary() {
    await flushSave();
    setEditorImage(null);
    await refreshLibrary();
    void mergeAccountMenus();
    navigateTo({ screen: "library" }, false, false);
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
  function applySelection(nextFiles: File[]) {
    // Any change of pages invalidates the draft tied to the old selection.
    draftTokenRef.current += 1;
    draftDocRef.current = null;
    setDraftSave("idle");
    pages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    const next = nextFiles.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    liveUrlsRef.current = next.map((page) => page.previewUrl);
    setPages(next);
    setFileError(null);
    setExtractError(null);
    setExtracted(null);
    setResultDoc(null);
    setDemoDoc(null);
    setInitialReviewCount(null);
    setExtractProgress(null);
    setPhase(next.length > 0 ? "ready" : "upload");
  }

  /** Start (or restart) a selection from the dropzone — replaces every page. */
  async function selectFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    if (!(await confirmDiscard())) return;
    const check = validateImageBatch(incoming);
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    applySelection(incoming);
  }

  /**
   * Append pages to the current selection; the whole set is validated as one
   * batch. Adding a page never discards the images — only a previous
   * extraction of them is stale — so the confirm says exactly that, and the
   * new extraction runs right away over the old pages plus the new ones
   * instead of making the user press Extract a second time.
   */
  async function addPages(incoming: File[]) {
    if (incoming.length === 0) return;
    if (phase === "extracting") {
      setFileError("An extraction is running — add pages once it finishes.");
      return;
    }
    const combined = [...pages.map((page) => page.file), ...incoming];
    const check = validateImageBatch(combined);
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    // The add control only exists while pages are selected, so there is
    // always a previous selection to combine; the guard in confirmDiscard
    // decides whether there is an extraction result worth confirming.
    const confirmMessage =
      `This discards the current extraction result — the images themselves are kept. ` +
      `A new extraction will run on all ${combined.length} images together: the ` +
      `${pages.length} already selected plus ${incoming.length} new ` +
      `${incoming.length === 1 ? "page" : "pages"}. Continue?`;
    if (!(await confirmDiscard(confirmMessage))) return;
    applySelection(combined);
    void extractFiles(combined);
  }

  /** Replace one page, keeping the rest of the selection in place. */
  function replacePageAt(index: number, nextFile: File) {
    if (!pages[index]) return;
    const check = validateImageBatch(pages.map((page, i) => (i === index ? nextFile : page.file)));
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    applySelection(pages.map((page, i) => (i === index ? nextFile : page.file)));
  }

  /** Drop one page; dropping the last one returns to the dropzone. */
  async function removePage(index: number) {
    if (!(await confirmDiscard())) return;
    applySelection(pages.filter((_, i) => i !== index).map((page) => page.file));
  }

  function clearCapture() {
    applySelection([]);
  }

  /** Run one extraction over an explicit file list (normally the selection). */
  async function extractFiles(files: File[]) {
    if (files.length === 0 || phase === "extracting") return;
    setPhase("extracting");
    setFileError(null);
    setExtractError(null);
    setExtractProgress({ pageCount: files.length, preparedPages: 0, requestStartedAt: null });
    try {
      // Normalize first: AVIF is transcoded to JPEG here because the provider
      // cannot read it, and mislabeled files get their real MIME type. One at
      // a time, so the page count in the progress panel is a real milestone.
      const prepared: Awaited<ReturnType<typeof prepareImageForUpload>>[] = [];
      for (const file of files) {
        prepared.push(await prepareImageForUpload(file));
        setExtractProgress((current) =>
          current ? { ...current, preparedPages: current.preparedPages + 1 } : current
        );
      }
      setExtractProgress((current) =>
        current ? { ...current, requestStartedAt: Date.now() } : current
      );
      const extraction = await extractMenuFromFiles(
        prepared.map((image) => new File([image.blob], image.filename, { type: image.mimeType }))
      );
      const previewDoc =
        extraction.menu.categories.length > 0
          ? extractedMenuToDocument(extraction.menu, {
              provider: extraction.provider,
              model: extraction.model,
              originalFileName: files[0]?.name,
            })
          : null;
      setResultDoc(previewDoc);
      setExtracted(extraction);
      setInitialReviewCount(
        previewDoc == null
          ? 0
          : previewDoc.categories.reduce((sum, c) => sum + c.items.filter(isItemFlagged).length, 0)
      );
      setSource("ai");
      setPhase("done");
      void autoSaveDraft(extraction, files[0] ?? null, previewDoc);
    } catch (error) {
      setExtractError(
        error instanceof ExtractClientError
          ? error
          : error instanceof PrepareImageError
            ? new ExtractClientError("invalid_file_type", error.message)
            : new ExtractClientError("internal_error", "Something went wrong. Try again.")
      );
      setPhase("ready");
    }
    scrollToResult();
  }

  function handleExtract() {
    void extractFiles(pages.map((page) => page.file));
  }

  async function handleDemo() {
    if (!(await confirmDiscard())) return;
    clearCapture();
    const doc = createSampleMenuDocument();
    setDemoDoc(doc);
    setResultDoc(doc);
    setInitialReviewCount(
      doc.categories.reduce((sum, c) => sum + c.items.filter(isItemFlagged).length, 0)
    );
    setSource("demo");
    setPhase("done");
    scrollToResult();
  }

  /**
   * Persist an extraction immediately, so reviewing the draft in the editor
   * is optional rather than the act of saving. Skips empty results (nothing
   * worth storing) and keeps the newest draft when extractions overlap.
   */
  async function autoSaveDraft(
    extraction: MenuExtractionResult,
    primaryPage: File | null,
    existingDoc: MenuDocument | null = null
  ) {
    const token = (draftTokenRef.current += 1);
    if (extraction.menu.categories.length === 0) {
      draftDocRef.current = null;
      setDraftSave("idle");
      return;
    }
    const doc =
      existingDoc ??
      extractedMenuToDocument(extraction.menu, {
        provider: extraction.provider,
        model: extraction.model,
        originalFileName: primaryPage?.name,
      });
    draftDocRef.current = doc;
    // One blob per menu: the first page stands in as the source image.
    const primaryPageBlob = primaryPage;
    if (storageDownRef.current) {
      setDraftSave("unavailable");
      return;
    }
    setDraftSave("saving");
    try {
      const saved = await saveMenu(doc);
      if (primaryPageBlob) {
        try {
          await saveImage(saved.id, primaryPageBlob);
        } catch {
          // Image is optional; the menu matters.
        }
      }
      if (token !== draftTokenRef.current) return;
      draftDocRef.current = saved;
      // A draft saved while signed in belongs to this account from now on:
      // sign-out must hide it, published or not. Empty baseline — the menu
      // is not confirmed on the server yet — and stamping never downgrades
      // an existing stamp.
      const autosaveActor = signedInRef.current ? accountKeyRef.current : null;
      if (autosaveActor) await stampDraftOrigin(saved.id, autosaveActor, "");
      setDraftSave("saved");
      await refreshLibrary();
    } catch (error) {
      if (token !== draftTokenRef.current) return;
      setDraftSave("unavailable");
      setExtractError(
        new ExtractClientError(
          "internal_error",
          error instanceof StorageError
            ? error.message
            : "The draft could not be saved in this browser, but you can still edit it."
        )
      );
    }
  }

  /** Save the current result (AI or demo) and open it in the editor. */
  /**
   * Persist the current result and open it. The wizard entry point reuses
   * this without touching the URL, then navigates once to its own mode.
   */
  async function saveResultAndOpen(updateRoute = true): Promise<MenuDocument> {
    if (source === "ai" && extracted) {
      const firstPage = pages[0];
      // Reuse the autosaved draft instead of writing a second record.
      const doc =
        draftDocRef.current ??
        extractedMenuToDocument(extracted.menu, {
          provider: extracted.provider,
          model: extracted.model,
          originalFileName: firstPage?.file.name,
        });
      const saved = storageDownRef.current ? doc : await saveMenu(doc);
      if (firstPage && !storageDownRef.current) {
        try {
          // One blob per menu: the first page stands in as the source image.
          await saveImage(saved.id, firstPage.file);
        } catch {
          // Image is optional; the menu matters.
        }
      }
      if (!storageDownRef.current) await refreshLibrary();
      await openDoc(saved, firstPage ? firstPage.file : null, updateRoute, "local");
      return saved;
    }
    const doc = demoDoc ?? createSampleMenuDocument();
    const saved = storageDownRef.current ? doc : await saveMenu(doc);
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
  function patchResultDoc(next: MenuDocument) {
    setResultDoc(next);
    if (source === "demo") setDemoDoc(next);
    draftDocRef.current = next;
  }

  /** Persist a confirmation to IndexedDB (demo stays in memory until saved). */
  async function persistResultDoc(next: MenuDocument) {
    if (storageDownRef.current || source === "demo") return;
    // Invalidate an in-flight autosave so its stale completion cannot
    // overwrite the confirmation it raced.
    draftTokenRef.current += 1;
    setDraftSave("saving");
    try {
      const saved = await saveMenu(next);
      draftDocRef.current = saved;
      // Same rule as the autosave: a confirmation made while signed in
      // marks the row, so sign-out hides it. Never downgrades a stamp.
      const confirmActor = signedInRef.current ? accountKeyRef.current : null;
      if (confirmActor) await stampDraftOrigin(saved.id, confirmActor, "");
      setResultDoc(saved);
      setDraftSave("saved");
      await refreshLibrary();
    } catch {
      setDraftSave("unavailable");
    }
  }

  /** "Looks good" clears the AI notes; "leave unpriced" also accepts the
   * null price (e.g. market price). Prices are never invented. */
  function handleResolveResultItem(loc: ReviewItemLocation, resolution: ReviewResolution) {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item) return;
    const next =
      resolution === "leave-unpriced"
        ? acceptItemUnpriced(doc, category.id, item.id)
        : confirmItemReviewed(doc, category.id, item.id);
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Fix a flagged price in the Check-this queue. Blank stays blank;
   * entering a number resolves Check price; clearing back to blank
   * re-flags unless the item was accepted as intentionally unpriced. */
  function handleUpdateResultPrice(loc: ReviewItemLocation, price: number | null) {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item) return;
    // Filling in a missing price replaces the AI's uncertainty about it:
    // the owner's number clears the notes in the same tap. Editing an
    // existing price leaves notes alone — they may concern something else,
    // and "Looks good" confirms those explicitly.
    const next = updateItem(
      doc,
      category.id,
      item.id,
      !hasAnyPrice(item) && price !== null ? { price, reviewNotes: [] } : { price }
    );
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** The impatient path: confirm every flagged item as shown. Null prices
   * stay null (totals stay honestly blank) — nothing is invented. */
  function handleResolveAllResultItems() {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    let next = doc;
    for (const category of doc.categories) {
      for (const item of category.items) {
        if (!isItemFlagged(item)) continue;
        next = hasAnyPrice(item)
          ? confirmItemReviewed(next, category.id, item.id)
          : acceptItemUnpriced(next, category.id, item.id);
      }
    }
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Q2: the result title is an editable field, never a naming gate.
   * Commits persist to the draft like price fixes; blank is ignored. */
  function handleRenameResultTitle(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc || doc.title === trimmed) return;
    const next = { ...doc, title: trimmed };
    patchResultDoc(next);
    void persistResultDoc(next);
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
      navigateTo({ screen: "editor", menuId: saved.id, mode: "publish" });
    } catch (error) {
      showOpenError(error);
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

  async function handleImportFile(importFile: File) {
    setImportError(null);
    try {
      const doc = parseImportedMenu(await importFile.text());
      const saved = storageDownRef.current ? doc : await saveMenu(doc);
      if (!storageDownRef.current) await refreshLibrary();
      await openDoc(saved, null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import that file.");
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
   * The acting café's id, and the same answer for async work that finishes
   * after the render that decided it. Both come from the provider above the
   * shell, so the switcher, the tabs and the café-keyed read cannot disagree.
   */
  const activeRestaurantId = activeWorkspace?.restaurantId ?? null;
  const activeRestaurantIdRef = useRef<string | null>(activeRestaurantId);
  activeRestaurantIdRef.current = activeRestaurantId;
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
    if (!belongsToTarget) navigateTo({ screen: "library" });
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
  // A name for the first-run "Name your restaurant" field, guessed from the
  // titles of the menus the move would copy (null when they say nothing).
  const suggestedRestaurantName = suggestRestaurantName(localOnly.map((menu) => menu.title));

  // The claim surfaces stay out of the editor: importing the menu that is
  // open would create an account version the editor is not synced with. The
  // wizard's own publish handles the open draft, and the post-publish import
  // above covers the rest.
  const storedClaimStatus = accountKey ? loadLocalDraftClaim(accountKey) : "unseen";
  const claimStatus =
    claimAnswer?.accountKey === accountKey ? claimAnswer.status : storedClaimStatus;
  // The editor suppresses the *offer* (importing the open menu would fork
  // the revision the editor is holding), but never the empty-account
  // auto-import: signing in inside the publish wizard is the onboarding
  // path, and leaving it ungated strands the draft as anonymous — the next
  // sign-out resurrects the resume banner for a menu the account owns.
  //
  // "pending" and "unavailable" are real answers, not stand-ins for "none".
  // While the session or the account's inventory is still loading the
  // decision is *unknown* (the resume banner once read that unknown as a
  // settled "none", passed its `!== "offer"` check and rendered in the load
  // gap — the flicker). A read that *failed* is unknown too, and must never
  // be read as an empty account: that would push this browser's drafts at a
  // server that did not answer. Signed out and settled, the decision really
  // is "none".
  const claimGate = deriveClaimGate({
    sessionPending,
    signedIn,
    menus: accountReadState({
      accountKey,
      settledFor: serverMenusFor,
      failedFor: serverMenusReadFailedFor,
    }),
    restaurants: accountReadState({
      accountKey,
      settledFor: restaurantSettledFor,
      failedFor: restaurantFailedFor,
    }),
  });
  /**
   * Browser drafts are the owner's to file: the offer and the automatic
   * import both write to a café, so they exist only while the shell acts in a
   * membership that can write menus. On a staff shift they wait, and come
   * back after switching to the owner café — the other membership's cafés are
   * never offered as a target here.
   */
  const canFileBrowserDrafts = signedIn && accountCan("menus.write");
  const localDraftsDecision = canFileBrowserDrafts
    ? decideLocalDraftClaimSurface({
        gate: claimGate,
        signedIn,
        claim: {
          localCount: localOnlyCount,
          accountMenuCount: serverIds.size,
          restaurantCount: restaurantList?.length ?? 0,
          ownedRestaurantCount: ownedRestaurantsForAccount.length,
          status: claimStatus,
        },
      })
    : "none";
  // Neither claim surface renders while the gate says the account is unknown.
  const claimSurfaceQuiet = localDraftsDecision === "none" || localDraftsDecision === "unavailable";

  // The resume banner names one menu as an unpublished browser draft, which it
  // reads off the account's id set — so it waits for that set to have actually
  // answered. A failed read settles the gate (002's notice says so), but it
  // cannot tell an account menu from a draft: every menu would look local and
  // the banner would hand an account menu back as unpublished (017).
  const resumeReady = resumeBannerReady({
    libraryLoading,
    gate: claimGate,
    signedIn,
    accountMenusSettled: libraryAccountMode,
  });

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
    if (!signedIn || !accountKey) return;
    // Unknown is not "empty": no server work while a read is in flight, and
    // none after one failed. The evaluation stays unmarked, so a later
    // successful read in this session can still run it.
    if (claimGate.pending || claimGate.incomplete) return;
    if (claimEvaluatedRef.current === accountKey) return;
    claimEvaluatedRef.current = accountKey;
    if (localDraftsDecision !== "auto-import") return;
    const titles = localOnly.map((menu) => menu.title);
    // Deferred: the effect must not set state synchronously while rendering
    // the frame that made the decision.
    void Promise.resolve().then(() => handleAutoClaim(titles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountKey,
    claimGate.incomplete,
    claimGate.pending,
    claimStatus,
    localDraftsDecision,
    screen,
    signedIn,
  ]);

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
  useEffect(() => {
    if (!followMenuCafe || !routedMenuRestaurantId) return;
    // Deferred like the other account reads: never set state synchronously
    // while rendering the frame that decided to switch.
    void Promise.resolve().then(() => switchWorkspace(routedMenuRestaurantId));
  }, [followMenuCafe, routedMenuRestaurantId, switchWorkspace]);

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
    hasWorkingSet: libraryMenus.length > 0,
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
   * `hasWorkingSet` is not a fact until IndexedDB has been read, and the
   * session is not settled until its read answers, so the column stays off
   * until both are known instead of flashing account chrome at a visitor.
   */
  const showShellColumn =
    !sessionPending &&
    !libraryLoading &&
    shellColumnVisible({
      sessionState,
      hasWorkingSet: libraryMenus.length > 0,
    });
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

  // A typed URL or old bookmark for a surface this membership cannot use
  // lands on the first one it can — Capture for an owner, My menus for a
  // staff shift. Unknown access is not a refusal: the guard waits.
  useEffect(() => {
    if (!signedIn || accountAccessPending) return;
    const guarded = routeRef.current.screen;
    if (guarded === "assistant" && featureFlagsLoading) return;
    // The editor and item pages answer for themselves: their menu carries
    // the server's own access answer, and a foreign menu moves the
    // switcher (below) rather than being refused here.
    if (guarded === "editor" || guarded === "item") return;
    // A membership with no usable surface has nowhere to send anyone; it
    // keeps the page it has rather than bouncing between two refusals.
    const landing = sections[0]?.id;
    if (!availableScreenIds.has(guarded) && landing) {
      navigateTo({ screen: landing }, true);
    }
  });

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

  return (
    <OrderMonitorProvider
      userId={userId}
      restaurantId={activeWorkspace?.restaurantId ?? null}
      pending={sessionPending || accountAccessPending}
    >
      <div className="flex min-h-full flex-1 flex-col">
        {dialog}
        <ViewingTracker viewing={signedIn && screen === "orders"} />
        {/* Default stretch: the content column fills the row, so its flex-1 main
          absorbs the spare height and the footer rests on the viewport bottom
          instead of floating under short content. */}
        <div className="flex w-full flex-1">
          {showShellColumn ? (
            <AppSidebar
              sections={sessionPending ? [] : navSections}
              activeSection={sectionForScreen(screen)}
              sessionPending={sessionPending}
              signedIn={signedIn}
              email={email}
              onNavigate={(section) => navigateTo({ screen: section })}
              onSignOut={() => void authClient.signOut()}
              outline={sidebarOutline}
              outlineKey={sidebarOutlineKey}
              onOutlineSelect={scrollToMenuSection}
              launch={sidebarLaunch}
              menusPending={sidebarMenuCountPending}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Wherever the column is absent the row carries the brand, and
              signed out it carries the only sign-in path. It hides itself
              below `sm` only when the sidebar is already showing the lockup;
              nothing here is sticky, so no screen loses height twice. */}
            <BrandBar
              signedIn={signedIn}
              sessionPending={sessionPending}
              className={showShellColumn ? "sm:hidden" : undefined}
            />
            {/* The sidebar names the account, not the café on shift: a second
              membership keeps its "Acting as" strip, which sits above the
              content now that the old header row is gone. */}
            <WorkspaceSwitcher
              workspaces={workspaces}
              active={activeWorkspace}
              onSwitch={handleSwitchWorkspace}
            />
            <main
              className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 pt-2 pb-8 sm:px-6 sm:py-8 ${
                // The editor is a dense working surface; the other app screens
                // share the remaining width beside the sidebar instead of
                // keeping the marketing measure they had under a top bar.
                screen === "editor" ? "max-w-6xl" : "max-w-5xl"
              }`}
            >
              {signedIn && claimNotice && screen !== "editor" && (
                <LocalDraftsNotice
                  notice={claimNotice}
                  onOpenLibrary={() => navigateTo({ screen: "library" })}
                  onDismiss={() => setClaimNotice(null)}
                />
              )}
              {!claimNotice &&
                localDraftsDecision === "offer" &&
                screen !== "editor" &&
                ownedRestaurantsForAccount.length > 0 && (
                  <LocalDraftsOffer
                    count={localOnlyCount}
                    restaurants={ownedRestaurantsForAccount}
                    busy={claimBusy}
                    onAdd={handleClaimAdd}
                    onDismiss={handleDismissClaim}
                  />
                )}
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
                  We couldn&apos;t check your account just now, so nothing was imported from this
                  browser. Reload when you&apos;re back online and it will try again.
                </p>
              )}

              {/* Q7 resume banner: the way back for anyone who wandered off (or
            returns from the magic-link email) with a saved-but-unpublished
            draft. Whether a draft is unpublished is *server* knowledge, so
            this renders only after `resumeReady` (session, library and —
            signed in — an account menu list that answered) and only with a
            confirmed `resumeDismissed === false`: until then it is
            invisible, never provisional. Hidden in the editor (it has its
            own publish entry), while the result is on screen (it IS the
            continue path), and while the claim surfaces speak. */}
              {(screen === "capture" || screen === "library") &&
                result === null &&
                resumeReady &&
                resumeDismissed === false &&
                localOnlyCount > 0 &&
                !claimNotice &&
                claimSurfaceQuiet &&
                (() => {
                  const resumable = localOnly.find((menu) => !menu.corrupt);
                  if (!resumable) return null;
                  return (
                    <HeightReveal>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-warning-950">
                            📍 Finish publishing your menu →
                          </p>
                          <p className="mt-0.5 max-w-xl text-xs leading-5 text-warning-900">
                            {localOnlyCount === 1
                              ? `“${resumable.title}” is saved in this browser, not published yet.`
                              : `${localOnlyCount} drafts saved in this browser, none published yet. Continuing with “${resumable.title}”.`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              navigateTo({
                                screen: "editor",
                                menuId: resumable.id,
                                mode: "publish",
                              })
                            }
                            className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                          >
                            Continue →
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
                  );
                })()}

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
                  signedIn={signedIn}
                  importCount={localOnlyCount}
                  importMenuIds={localOnly.map((menu) => menu.id)}
                  suggestedName={suggestedRestaurantName}
                  ownedRestaurants={ownedRestaurantsForAccount}
                  unavailable={storageDown}
                  onOpen={(id) => void handleOpenMenu(id)}
                  onNew={(suggestedTitle?: string) => void handleNewMenu(suggestedTitle)}
                  onRename={(id, title) => void handleRenameMenu(id, title)}
                  onDelete={(id) => void handleDeleteMenu(id)}
                  onMoveToAccount={handleMoveMenuToAccount}
                  onMoved={(report) => {
                    const actor = accountKeyRef.current;
                    void (async () => {
                      if (actor) {
                        await stampClaimedMenus(
                          [...report.imported, ...report.skipped],
                          actor,
                          (id) => getMenu(id)
                        );
                      }
                      await mergeAccountMenus();
                    })();
                  }}
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
                      (menu) =>
                        serverIds.has(menu.id) && accessCan(menuAccess.get(menu.id), "menus.write")
                    )
                    .map((menu) => ({ id: menu.id, title: menu.title }))}
                  onBackToCapture={() => navigateTo({ screen: "capture" })}
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
                        Your account can’t open this menu. Ask the restaurant owner if you think
                        that’s a mistake.
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
                          You have staff access to this restaurant — menus are view-only for staff.
                          Ask an owner to make changes.
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
                          onBack={() =>
                            navigateTo({ screen: "editor", menuId: routedDoc.id, mode: "edit" })
                          }
                          onOpenTables={() => navigateTo({ screen: "tables" })}
                          onOpenEditor={() =>
                            navigateTo({ screen: "editor", menuId: routedDoc.id, mode: "edit" })
                          }
                        />
                      ) : (
                        <MenuEditor
                          doc={routedDoc}
                          selectedItemId={selectedItemId}
                          mode={activeMenuCanWrite ? editorMode : "preview"}
                          onModeChange={(mode) =>
                            navigateTo({ screen: "editor", menuId: routedDoc.id, mode })
                          }
                          onChange={handleDocChange}
                          saveState={saveState}
                          syncMode={signedIn ? "account" : "local"}
                          canManage={activeMenuCanWrite}
                          onServer={activeMenuOnServer}
                          accountCheckFailed={activeMenuAccountCheckFailed}
                          onRetryAccountCheck={handleRetryAccountCheck}
                          restaurantName={
                            ownedRestaurantsForAccount.find(
                              (restaurant) => restaurant.id === activePublication?.restaurantId
                            )?.name ?? null
                          }
                          onStartPublish={() =>
                            navigateTo({ screen: "editor", menuId: routedDoc.id, mode: "publish" })
                          }
                          imageUrl={editorImageUrl}
                          onExportJson={handleExportJson}
                          onExportCsv={handleExportCsv}
                          onImportFile={(f) => void handleImportFile(f)}
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
                            onRetryAccountCheck: handleRetryAccountCheck,
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
                  initialReviewCount={initialReviewCount}
                  onClear={clearCapture}
                  onEdit={() => void handleEditResult()}
                  onResolveItem={handleResolveResultItem}
                  onResolveAll={handleResolveAllResultItems}
                  onUpdatePrice={handleUpdateResultPrice}
                  onRenameTitle={handleRenameResultTitle}
                  onPublish={
                    source === "demo" || draftSave === "saved"
                      ? () => void handleStartPublish()
                      : undefined
                  }
                />
              )}

              {screen === "editor" && !routedDoc && missingPublishMenuId && (
                <MissingDraftCard
                  onOpenLibrary={() => navigateTo({ screen: "library" })}
                  onStartFresh={() => navigateTo({ screen: "capture" })}
                />
              )}
              {screen === "editor" && !routedDoc && !missingPublishMenuId && sessionCheckGaveUp && (
                <section className="rounded-2xl border border-line-200 bg-surface-base p-6 text-center">
                  <h1 className="font-medium text-ink-900">Checking your session…</h1>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
                    We couldn’t reach your account just now, so this menu hasn’t been opened. Your
                    draft is still saved in this browser — nothing is lost.
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
                      onClick={() => navigateTo({ screen: "library" })}
                      className="rounded-full px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                    >
                      Back to My menus
                    </button>
                  </div>
                </section>
              )}
              {screen === "editor" &&
                !routedDoc &&
                !missingPublishMenuId &&
                !sessionCheckGaveUp && (
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
            </main>
            <SiteFooter />
          </div>
        </div>
        {/*
        Phone nav: signed in, the tab bar pins Capture · My menus · Orders ·
        More (Orders keeps its home for the R0.3 monitor badge; the rest
        lives in the More sheet). Signed out, the shell is capture-only:
        Capture plus My menus only when anonymous drafts exist to continue —
        no Orders, no More. Sits after the footer so it is the last thing on
        the page and sticks to the viewport bottom instead of floating above
        the footer links.
      */}
        {navReady && (signedIn || (!libraryLoading && libraryMenus.length > 0)) ? (
          <nav
            data-print-hide
            aria-label="Sections"
            className="sticky bottom-0 z-30 border-t border-line-200 bg-surface-base/95 backdrop-blur-sm sm:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex px-2 pt-1">
              {phoneTabList.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    navigateTo({ screen: tab.id });
                  }}
                  aria-current={screen === tab.id ? "page" : undefined}
                  className={`relative flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                    screen === tab.id ? "text-accent-700" : "text-ink-500"
                  }`}
                >
                  {tab.id === "orders" && <NewOrdersBadge tone="bar" />}
                  <span aria-hidden="true" className="flex h-[22px] items-center">
                    <PhoneTabIcon id={tab.id} />
                  </span>
                  {tab.label}
                </button>
              ))}
              {signedIn && (moreRows.length > 0 || canGetStarted) && (
                <button
                  type="button"
                  onClick={() => setMoreOpen((open) => !open)}
                  aria-expanded={moreOpen}
                  aria-current={screenInMore ? "page" : undefined}
                  className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                    moreOpen || screenInMore ? "text-accent-700" : "text-ink-500"
                  }`}
                >
                  <span aria-hidden="true" className="flex h-[22px] items-center">
                    <MoreIcon size={22} />
                  </span>
                  More
                </button>
              )}
            </div>
          </nav>
        ) : null}
        {signedIn && moreOpen && (
          <div className="sm:hidden">
            <div
              aria-hidden="true"
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-40 bg-scrim"
            />
            <div
              role="dialog"
              aria-label="More"
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-line-200 bg-surface-base px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <div
                aria-hidden="true"
                className="mx-auto mb-1 h-1.5 w-11 rounded-full bg-surface-200"
              />
              {moreRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    navigateTo({ screen: row.id });
                  }}
                  className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left transition-colors hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <span className="text-sm font-semibold text-ink-900">{row.label}</span>
                  <span className="text-xs font-normal text-ink-500">{row.why}</span>
                </button>
              ))}
              {/* The checklist is progress, not another destination: its own
                card above the rule, with the count the sidebar shows. It
                stays an owner's surface (`settings.manage`), like the Get
                started link it replaces. */}
              {canGetStarted && (
                <a
                  href="/launch"
                  className="mt-2 flex min-h-[56px] items-center gap-3 rounded-xl border border-line-200 bg-surface-50 px-3 py-2.5 transition-colors hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-base text-ink-600"
                  >
                    <ChecklistIcon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-900">
                      Launch checklist
                    </span>
                    <span className="block text-xs font-normal text-ink-500">
                      {sheetLaunchHint}
                    </span>
                  </span>
                  {sidebarLaunch ? (
                    <span
                      aria-hidden="true"
                      className="shrink-0 rounded-full bg-surface-base px-2 py-0.5 text-[11px] font-semibold text-ink-600"
                    >
                      {sidebarLaunch.done}/{sidebarLaunch.total}
                    </span>
                  ) : null}
                  {sidebarLaunch ? (
                    <span className="sr-only">
                      {sidebarLaunch.done} of {sidebarLaunch.total} steps done
                    </span>
                  ) : null}
                </a>
              )}
              {/* The app has no top bar on a phone, so the account lives here:
                one place to see who is signed in and to end the session. It
                is the last thing in the sheet, under the destinations. */}
              <div className="mt-2 border-t border-line-200 pt-1">
                <p className="truncate px-2 pt-1 text-[11px] text-ink-500">{email}</p>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    void authClient.signOut();
                  }}
                  className="flex min-h-[44px] w-full items-center rounded-xl px-2 text-left text-sm font-medium text-ink-700 transition-colors hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
        <MonitorToastStack onOpen={() => navigateTo({ screen: "orders" })} />
      </div>
    </OrderMonitorProvider>
  );
}

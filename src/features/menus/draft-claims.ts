"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { suggestRestaurantName } from "@/features/menu/menu-utils";
import { DEMO_PROVIDER } from "@/features/menu/sample-menu";
import { deleteImage, deleteMenu, getMenu } from "@/features/menu/storage";
import { clearDraftOrigin, stampClaimedMenus } from "@/features/menus/draft-origins";
import {
  accountReadState,
  decideLocalDraftClaimSurface,
  decidePublishJourneyClaim,
  deriveClaimGate,
  draftsForAutoImport,
  resolveAutoClaimTarget,
} from "@/features/menus/claim-local-drafts";
import { clearDirectSignInIntent, loadDirectSignInIntent } from "@/features/menus/direct-sign-in";
import { moveLocalMenuToAccount, moveLocalMenusToAccount } from "@/features/menus/move-to-account";
import { forgetPendingNewMenu } from "@/features/menus/routed-doc";
import { fetchServerMenu, type MembershipAccess } from "@/features/menus/sync";
import { useLibrary } from "@/features/menus/library-context";
import {
  clearWizardLinkSent,
  clearWizardState,
  forgetPublishJourney,
  hasPublishJourney,
} from "@/features/publishing/wizard-state";
import { ensureFirstRestaurant } from "@/features/tenancy/first-restaurant";
import { useWorkspace } from "@/features/tenancy/workspace-context";
import type { AppScreen } from "@/features/navigation/routes";

/**
 * Draft claims: what happens to a menu that lives only in this browser when
 * an account appears. Sign-in adopts every draft in one go — no remembered
 * answers, no offer — so this is the one unit that decides where those rows
 * land, stamps them to the account, and dissolves the browser copy the
 * account just took.
 *
 * Two facts stay with the editor and arrive as doors rather than being
 * mirrored here: which document is open (`getOpenDocId`) and how to reconcile
 * it after its row was claimed (`onClaimedOpenDoc`).
 */
export type DraftClaimsOptions = {
  /** The document the editor holds right now, read at call time. */
  getOpenDocId(): string | null;
  /** The claim took the open row over: pin the editor to the agreed revision. */
  onClaimedOpenDoc(menuId: string): Promise<void>;
  /** The menu the URL names, if any (onboarding journey claim). */
  routeMenuId: string | null;
  /** Which screen is showing; the automatic import re-evaluates on a change. */
  screen: AppScreen;
};

export type DraftClaimsValue = {
  claimError: string | null;
  setClaimError: (message: string | null) => void;
  /** Three-state: the account's reads have answered, are pending, or failed. */
  claimGate: ReturnType<typeof deriveClaimGate>;
  /** Whether the owner's surfaces may offer to file drafts at all. */
  canFileBrowserDrafts: boolean;
  localDraftsDecision: ReturnType<typeof decideLocalDraftClaimSurface>;
  /** Neither claim surface renders while the account is unknown. */
  claimSurfaceQuiet: boolean;
  /** Copy the browser's visible drafts into one owned café. */
  runLocalDraftClaim(restaurantId: string, menuIds?: readonly string[]): Promise<void>;
  /** Remove a browser row and its stamp (after a claim, or for demo data). */
  dissolveBrowserMenu(menuId: string): Promise<void>;
  /** Remove several browser rows with every mark they carry. */
  wipeBrowserMenus(menuIds: readonly string[]): Promise<void>;
  /** Split browser rows into real menus and sample rows. */
  partitionRealMenus(ids: readonly string[]): Promise<{ real: string[]; demo: string[] }>;
  /** Sign-out: the account's decision about this browser's drafts is gone. */
  resetClaimState(): void;
};

export function useDraftClaims({
  getOpenDocId,
  onClaimedOpenDoc,
  routeMenuId,
  screen,
}: DraftClaimsOptions): DraftClaimsValue {
  const workspace = useWorkspace();
  const {
    menus,
    serverIds,
    serverMenusFor,
    serverMenusReadFailedFor,
    refreshLibrary,
    mergeAccountMenus,
    addServerId,
    setMenuAccessFor,
    rememberMenuCafe,
  } = useLibrary();

  const {
    signedIn,
    accountKey,
    can: accountCan,
    sessionPending,
    settledFor: restaurantSettledFor,
    failedFor: restaurantFailedFor,
    owned: ownedRestaurantsForAccount,
    restaurants: restaurantList,
  } = workspace;
  const activeRestaurantId = workspace.active?.restaurantId ?? null;

  const [claimError, setClaimError] = useState<string | null>(null);
  /**
   * The first settled non-editor look at this account decides whether the
   * automatic import runs. Later local menus (a demo saved mid-session) are
   * never swept into an account behind the owner's back.
   */
  const claimEvaluatedRef = useRef<string | null>(null);
  /** Which journey menu already attached this session (one entry per menu). */
  const journeyClaimRef = useRef<string | null>(null);

  const localOnly = menus.filter((menu) => !serverIds.has(menu.id));
  /**
   * The draft the magic link is returning to, when this browser has one.
   *
   * That draft is the journey claim's to take: the emailed link is its
   * consent, and the journey path is the one that names the café from it.
   * The generic import leaves it alone — both paths deciding on the same
   * draft is what made a brand-new account create two cafés, since each read
   * "no café yet" and each created one. A journey draft nobody is returning
   * to (any other route) is not excluded, so it still joins the account.
   */
  const journeyMenuId =
    routeMenuId !== null &&
    hasPublishJourney(routeMenuId) &&
    localOnly.some((menu) => menu.id === routeMenuId)
      ? routeMenuId
      : null;
  const autoClaimDrafts = draftsForAutoImport(localOnly, journeyMenuId);
  const autoClaimMenuIds = autoClaimDrafts.map((menu) => menu.id);

  // "pending" and "unavailable" are real answers, not stand-ins for "none".
  // While the session or the account's inventory is still loading the
  // decision is *unknown*; a read that *failed* is unknown too, and must
  // never be read as an empty account: that would push this browser's drafts
  // at a server that did not answer. Signed out and settled, the decision
  // really is "none".
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
   * back after switching to the owner café.
   */
  const canFileBrowserDrafts = signedIn && accountCan("menus.write");
  const localDraftsDecision = canFileBrowserDrafts
    ? decideLocalDraftClaimSurface({
        gate: claimGate,
        signedIn,
        claim: {
          localCount: autoClaimDrafts.length,
          accountMenuCount: serverIds.size,
          restaurantCount: restaurantList?.length ?? 0,
          ownedRestaurantCount: ownedRestaurantsForAccount.length,
        },
      })
    : "none";
  const claimSurfaceQuiet = localDraftsDecision === "none" || localDraftsDecision === "unavailable";

  /**
   * An attach just proved this menu lives on the account in a known café:
   * record both answers now instead of waiting for the café-keyed read,
   * which only knows the café the shell acts in. Without this a menu
   * attached into another café reads as on-account with no access — the
   * library's "View only" dead end. A skipped attach (already on the
   * server) carries no fresh answer, so the row is read back instead.
   */
  async function adoptAttachedMenu(
    menuId: string,
    restaurantId: string,
    access?: MembershipAccess
  ) {
    rememberMenuCafe(menuId, restaurantId);
    if (access) {
      setMenuAccessFor(menuId, access);
      return;
    }
    try {
      const server = await fetchServerMenu(menuId);
      rememberMenuCafe(menuId, server.restaurantId);
      setMenuAccessFor(menuId, server.access);
    } catch {
      // The café-keyed merge covers the common case; this only heals the
      // attach-into-another-café gap.
    }
  }

  /**
   * Copy the rest of this browser's menus into one owned restaurant. Shared
   * by the automatic import, the direct sign-in intent, and the import that
   * follows the wizard creating the account's first café. Freshly imported
   * rows dissolve; the notice reports per-batch totals.
   *
   * `menuIds` defaults to the drafts the generic import owns: the visible
   * browser-only rows minus a draft its own journey claim is taking.
   */
  async function runLocalDraftClaim(
    restaurantId: string,
    menuIds: readonly string[] = autoClaimMenuIds
  ) {
    setClaimError(null);
    try {
      // Only the visible browser-only rows move: hidden rows belong to
      // another session and are never swept into this account. Sample rows
      // are disregarded, never imported — signing in must not file demo
      // data into a real café.
      const { real, demo } = await partitionRealMenus(menuIds);
      for (const id of demo) await dissolveBrowserMenu(id);
      if (real.length === 0) {
        // Nothing but sample rows, already disregarded above: no import,
        // no notice.
        await refreshLibrary();
        return;
      }
      const report = await moveLocalMenusToAccount(restaurantId, real);
      for (const id of report.imported) {
        addServerId(id);
        await adoptAttachedMenu(id, restaurantId, report.accessById[id]);
      }
      for (const id of report.skipped) {
        addServerId(id);
        await adoptAttachedMenu(id, restaurantId);
      }
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
      const openId = getOpenDocId();
      const openClaimed =
        openId !== null && (report.imported.includes(openId) || report.skipped.includes(openId));
      if (openClaimed && openId !== null) {
        // Never fail the claim over it: the row is imported and stamped.
        await onClaimedOpenDoc(openId).catch(() => undefined);
      }
      // Dissolve what the account just took: a leftover row would come
      // back as an anonymous draft on sign-out. Skipped rows stay — they
      // may be ahead of the server, and the heal triages those on open.
      for (const id of report.imported) {
        await dissolveBrowserMenu(id);
      }
      // No notice: sign-in claims the drafts silently — the rows simply
      // appear in My menus, and a stranded row retries next sign-in.
      await refreshLibrary();
      void mergeAccountMenus(activeRestaurantId);
    } catch {
      setClaimError(
        "We couldn't read the menus saved in this browser. They are still here — they will join your account the next time you sign in."
      );
    }
  }

  /**
   * Sign-in adopts this browser's drafts in one go, whether or not the
   * account already holds menus. Where they land is the account's own café
   * when it has one — an empty café is still *its* café — and only an
   * account that owns none gets one created, named from the menu titles
   * rather than a placeholder the owner cannot recognise. Reusing is what
   * stops a retried claim from minting a second café next to the first.
   */
  async function handleAutoClaim(titles: string[]) {
    if (!accountKey) return;
    setClaimError(null);
    try {
      const target = resolveAutoClaimTarget(ownedRestaurantsForAccount, titles);
      if (target.kind === "reuse") {
        await runLocalDraftClaim(target.restaurantId);
        return;
      }
      // One creation per account, shared with the journey claim and the
      // editor's autosave: asking the same question three times at once used
      // to produce two cafés.
      const created = await ensureFirstRestaurant(accountKey, target.name);
      workspace.addRestaurant(created);
      await runLocalDraftClaim(created.id);
    } catch {
      setClaimError(
        "We couldn't set up your café automatically. Your menus are still in this browser — they will join your account the next time you sign in."
      );
    }
  }

  /**
   * Onboarding promise: the draft opened in the publish wizard attaches to
   * the owner's workspace on sign-in, with no prior-menu check. Where it
   * lands: the café the shell acts in when it may file there, else the
   * owner's first café, else a new café named from the draft (brand-new
   * accounts). Staff-only sign-ins never reach here — there is no café the
   * caller may file in.
   */
  async function handlePublishJourneyClaim(menuId: string) {
    const actor = accountKey;
    if (!signedIn || !actor) return;
    setClaimError(null);
    try {
      const draft = await getMenu(menuId).catch(() => null);
      if (!draft) return;
      let targetId: string;
      if (canFileBrowserDrafts && activeRestaurantId) {
        targetId = activeRestaurantId;
      } else if (ownedRestaurantsForAccount.length > 0 && ownedRestaurantsForAccount[0]) {
        targetId = ownedRestaurantsForAccount[0].id;
      } else if ((restaurantList?.length ?? 0) === 0) {
        // Same door as the generic import and the editor's autosave: the
        // account's first café is created once, by whichever path asks first.
        const created = await ensureFirstRestaurant(
          actor,
          suggestRestaurantName([draft.title]) ?? "My restaurant"
        );
        workspace.addRestaurant(created);
        targetId = created.id;
      } else {
        setClaimError(
          "Your account can't file menus yet — ask the café owner to add this address in Settings → Team."
        );
        return;
      }
      const outcome = await moveLocalMenuToAccount(targetId, menuId);
      if (outcome.status === "failed") {
        setClaimError(`We couldn't add your menu to your account — ${outcome.reason}`);
        return;
      }
      addServerId(menuId);
      if (outcome.status === "imported") {
        await adoptAttachedMenu(menuId, targetId, outcome.access);
      } else {
        await adoptAttachedMenu(menuId, targetId);
      }
      await stampClaimedMenus([menuId], actor, (id) => getMenu(id));
      // The wizard holds the open row on a null baseline; reconcile it to
      // the agreed revision so the next save stays on the account.
      if (getOpenDocId() === menuId) {
        await onClaimedOpenDoc(menuId).catch(() => undefined);
      }
      // The account holds the copy now: dissolve the browser row so it
      // can never resurface as an anonymous draft on sign-out. A skipped
      // row (already on the server) may be ahead of it, so only a fresh
      // import dissolves — the heal triages the rest on open.
      if (outcome.status === "imported") await dissolveBrowserMenu(menuId);
      // Silent by design: the emailed link already promised this menu joins
      // the account, so no banner celebrates it.
      await refreshLibrary();
      void mergeAccountMenus(activeRestaurantId);
    } catch {
      setClaimError(
        "We couldn't add your menu to your account. It is still saved in this browser — it will join your account the next time you sign in."
      );
    }
  }

  /**
   * Dissolve a browser row: the document, its source photo, and its stamp.
   * Used after a successful attach (the account holds the copy now, so any
   * leftover would resurface as an anonymous draft on sign-out) and for
   * demo data (sample rows are never asked about). Wizard and journey marks
   * stay: an attached menu still exists, on the account.
   */
  async function dissolveBrowserMenu(menuId: string) {
    try {
      await deleteMenu(menuId);
    } catch {
      // The stamp already hides the row; the next save's prune retries.
    }
    try {
      await deleteImage(menuId);
    } catch {
      // Source photo only; the account copy is unaffected.
    }
    await clearDraftOrigin(menuId);
  }

  async function wipeBrowserMenus(menuIds: readonly string[]) {
    for (const menuId of menuIds) {
      try {
        await deleteMenu(menuId);
      } catch {
        // One stubborn row never blocks the rest.
      }
      await clearDraftOrigin(menuId);
      clearWizardState(menuId);
      clearWizardLinkSent(menuId);
      forgetPublishJourney(menuId);
      forgetPendingNewMenu(menuId);
    }
  }

  /**
   * Split browser rows into the owner's real menus and sample rows. Demo
   * data is never asked about — signing in disregards it — while an
   * unreadable row counts as real, so the dialogs still cover it and the
   * move reports it instead of silently dropping it.
   */
  async function partitionRealMenus(ids: readonly string[]): Promise<{
    real: string[];
    demo: string[];
  }> {
    const real: string[] = [];
    const demo: string[] = [];
    for (const id of ids) {
      try {
        const doc = await getMenu(id);
        (doc.source?.provider === DEMO_PROVIDER ? demo : real).push(id);
      } catch {
        real.push(id);
      }
    }
    return { real, demo };
  }

  // Direct "Sign in" choice: attach the named menus silently, or wipe them,
  // exactly once. Runs before the journey and generic claims so a discard
  // wins over any auto-import of the same rows.
  useEffect(() => {
    if (!signedIn || !accountKey) return;
    if (claimGate.pending || claimGate.incomplete) return;
    const intent = loadDirectSignInIntent();
    if (!intent || intent.menuIds.length === 0) return;
    clearDirectSignInIntent();
    if (intent.decision === "discard") {
      void (async () => {
        await wipeBrowserMenus(intent.menuIds);
        await refreshLibrary();
      })();
      return;
    }
    // The state writes below run in a task, not the effect body, so one
    // failing row reports without cascading a render off the sign-in sync.
    void (async () => {
      for (const menuId of intent.menuIds) {
        if (serverIds.has(menuId)) continue;
        const mayFile = canFileBrowserDrafts || (restaurantList?.length ?? 0) === 0;
        if (!mayFile) {
          setClaimError(
            "Your account can't file menus yet — ask the café owner to add this address in Settings → Team."
          );
          continue;
        }
        journeyClaimRef.current = `${accountKey}:${menuId}`;
        await handlePublishJourneyClaim(menuId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the claim functions are render-scoped on purpose; listing them would re-run this once-per-intent effect on every render
  }, [
    signedIn,
    accountKey,
    claimGate.pending,
    claimGate.incomplete,
    canFileBrowserDrafts,
    restaurantList,
    serverIds,
  ]);

  // Onboarding promise ("Sign in to publish your menu"): the journey draft
  // attaches on sign-in with no prior-menu check — the emailed link is
  // consent for that menu. The generic auto-import below stays as the
  // fallback for non-journey drafts.
  useEffect(() => {
    if (!signedIn || !accountKey) return;
    if (claimGate.pending || claimGate.incomplete) return;
    const menuId = routeMenuId;
    if (!menuId || !hasPublishJourney(menuId)) return;
    if (serverIds.has(menuId)) return;
    if (
      !decidePublishJourneyClaim({
        signedIn,
        mayFile: canFileBrowserDrafts || (restaurantList?.length ?? 0) === 0,
        journeyDraftLocal: localOnly.some((menu) => menu.id === menuId),
        alreadyClaimed: journeyClaimRef.current === `${accountKey}:${menuId}`,
      })
    )
      return;
    journeyClaimRef.current = `${accountKey}:${menuId}`;
    void handlePublishJourneyClaim(menuId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above: the attach runs once per journey menu, not once per render
  }, [
    signedIn,
    accountKey,
    routeMenuId,
    serverIds,
    localOnly,
    canFileBrowserDrafts,
    restaurantList,
    ownedRestaurantsForAccount,
    claimGate.pending,
    claimGate.incomplete,
  ]);

  const autoImport = useCallback(() => {
    if (!signedIn || !accountKey) return;
    // Unknown is not "empty": no server work while a read is in flight, and
    // none after one failed. The evaluation stays unmarked, so a later
    // successful read in this session can still run it.
    if (claimGate.pending || claimGate.incomplete) return;
    if (claimEvaluatedRef.current === accountKey) return;
    if (localDraftsDecision !== "auto-import") return;
    // Marked only when the import runs: rows that arrive later (an offline
    // save while signed in) must still be claimed instead of inheriting a
    // decision made when the browser held nothing.
    claimEvaluatedRef.current = accountKey;
    const titles = autoClaimDrafts.map((menu) => menu.title);
    // Deferred: the effect must not set state synchronously while rendering
    // the frame that made the decision.
    void Promise.resolve().then(() => handleAutoClaim(titles));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the import runs once per account and decision, not per render
  }, [signedIn, accountKey, claimGate.pending, claimGate.incomplete, localDraftsDecision, screen]);

  useEffect(() => {
    autoImport();
  }, [autoImport]);

  return {
    claimError,
    setClaimError,
    resetClaimState() {
      claimEvaluatedRef.current = null;
      journeyClaimRef.current = null;
      setClaimError(null);
    },
    claimGate,
    canFileBrowserDrafts,
    localDraftsDecision,
    claimSurfaceQuiet,
    runLocalDraftClaim,
    dissolveBrowserMenu,
    wipeBrowserMenus,
    partitionRealMenus,
  };
}

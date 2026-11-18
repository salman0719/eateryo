"use client";

import { useEffect, useRef, useState } from "react";

import type { MenuDocument } from "@/features/menu/schema";
import { menuContentHash, refreshDraftSync } from "@/features/menus/draft-origins";
import { fetchServerMenu, SyncError } from "@/features/menus/sync";
import { useLibrary } from "@/features/menus/library-context";
import {
  fetchLiveMenuDoc,
  fetchPublication,
  publishMenu,
  unpublishMenu,
} from "@/features/publishing/client";
import type { PublicationStatus } from "@/features/publishing/schema";
import type { PublishSetupResult } from "@/features/publishing/setup-schema";
import { useWorkspace } from "@/features/tenancy/workspace-context";

/**
 * The open menu's publication: whether it is live, what diners see now, and
 * the three actions that change it. It follows the document the editor holds
 * (`getOpenDocId`), flushes the pending save before publishing, and never
 * shows a status loaded for a different menu.
 */
export type PublicationOptions = {
  /** The document the editor holds right now, read at call time. */
  getOpenDoc(): MenuDocument | null;
  /** Save whatever the editor still owes before a snapshot is taken. */
  flushSave(): Promise<void>;
  /** Pin the open row to the revision the server agreed on. */
  onServerRevision(menuId: string, serverUpdatedAt: string): void;
  /** The menu gained a public link (the wizard's answer). */
  onPublishedMenu(menuId: string): void;
};

export function usePublication(options: PublicationOptions) {
  const { signedIn, accountKey, active } = useWorkspace();
  const { serverIdsRef, accountMenusSettledRef, addServerId, refreshLibrary, mergeAccountMenus } =
    useLibrary();

  /** Session answers for async work that finishes after an await. */
  const signedInRef = useRef(signedIn);
  const accountKeyRef = useRef<string | null>(accountKey);
  useEffect(() => {
    signedInRef.current = signedIn;
    accountKeyRef.current = accountKey;
  }, [signedIn, accountKey]);

  /**
   * Whether the document the editor holds right now is still `menuId`.
   *
   * One predicate, because the inline form is a trap: `a?.id ?? null === b`
   * parses as `a?.id ?? (null === b)`, which is truthy for any open document.
   * That read as "the doc changed" on every call, so each answer from the
   * server was dropped while `publicationLoaded` still flipped to true — and
   * the panel then said a published, live menu had never been published.
   */
  function openDocIs(menuId: string): boolean {
    return (options.getOpenDoc()?.id ?? null) === menuId;
  }

  const activeRestaurantId = active?.restaurantId ?? null;

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
      if (!openDocIs(menuId)) return;
      setLiveDoc(doc);
      setLiveDocState("ready");
    } catch (error) {
      if (!openDocIs(menuId)) return;
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
      if (!openDocIs(menuId)) return;
      setPublication(status);
      setPublishError(null);
      void refreshLiveDoc(menuId, status);
    } catch (error) {
      if (!openDocIs(menuId)) return;
      if (error instanceof SyncError && error.code === "not_found") {
        setPublication(null);
      } else {
        setPublishError("Could not check the menu’s status. Try again in a moment.");
      }
      resetLiveDoc();
    } finally {
      if (openDocIs(menuId)) setPublicationLoaded(true);
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
    const doc = options.getOpenDoc();
    if (!doc) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      await options.flushSave();
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
    const doc = options.getOpenDoc();
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
        if (openDocIs(menuId)) {
          options.onServerRevision(menuId, server.updatedAt);
        }
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
          await refreshLibrary();
        }
      } catch {
        // The next editor open reconciles the baseline; publishing already
        // succeeded, so this must not surface as a failure.
      }
    })();
    void mergeAccountMenus(activeRestaurantId);
    void refreshLibrary();
    options.onPublishedMenu(menuId);
  }

  /**
   * Drop everything that belongs to the previous menu. Publication is loaded
   * per open document, so a stale answer must never be shown under a new one.
   */
  function resetPublication() {
    setPublication(null);
    setPublicationMenuId(null);
    setPublicationLoaded(false);
    setPublishError(null);
    resetLiveDoc();
  }

  return {
    publication,
    publicationMenuId,
    publicationLoaded,
    publishBusy,
    publishError,
    liveDoc,
    liveDocMenuId,
    liveDocState,
    resetLiveDoc,
    resetPublication,
    refreshPublication,
    handlePublish,
    handleUnpublish,
    handleWizardPublished,
    setPublication,
    setPublicationMenuId,
    setPublicationLoaded,
    setPublishError,
  };
}

export type PublicationValue = ReturnType<typeof usePublication>;

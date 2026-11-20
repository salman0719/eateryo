"use client";

import { useEffect, useRef, useState } from "react";

import type { PageImage } from "@/components/upload/image-preview";
import type {
  NewDishDraft,
  PreviewMenu,
  ReviewItemLocation,
  ReviewResolution,
} from "@/components/upload/extraction-result";
import { extractedMenuToDocument } from "@/features/menu/convert";
import {
  acceptItemUnpriced,
  addItem,
  confirmItemReviewed,
  deleteItem,
  hasAnyPrice,
  isItemFlagged,
  moveItemToCategory,
  updateItem,
} from "@/features/menu/menu-utils";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import type { MenuDocument } from "@/features/menu/schema";
import { getImage, getMenu, saveImage, saveMenu, StorageError } from "@/features/menu/storage";
import { stampDraftOrigin } from "@/features/menus/draft-origins";
import { useLibrary } from "@/features/menus/library-context";
import {
  createServerMenu,
  fetchServerMenu,
  SyncError,
  type ServerMenu,
} from "@/features/menus/sync";
import { useWorkspace } from "@/features/tenancy/workspace-context";
import {
  ExtractClientError,
  extractMenuFromFiles,
  type MenuExtractionResult,
} from "@/lib/extract-client";
import { validateImageBatch } from "@/lib/image-constraints";
import { PrepareImageError, prepareImageForUpload } from "@/lib/prepare-image";

type Phase = "upload" | "ready" | "extracting" | "done";

/**
 * The two things capture needs from the screens around it, as doors rather
 * than shared state: the confirm dialog it asks before discarding an
 * extraction, and the menu lifecycle that files a new menu (server target,
 * local cache of a server row, pruning the signed-out drafts it supersedes).
 */
export type CaptureOptions = {
  confirmDiscard(message?: string): Promise<boolean>;
  ensureServerTarget(menuTitle: string): Promise<string | null>;
  cacheServerDraft(server: ServerMenu): Promise<MenuDocument>;
  pruneSignedOutOthers(keepId: string): Promise<void>;
  /** Bring the result screen into view (the screen owns the scrolling). */
  revealResult(): void;
  /** A failure the shell should report where it reports its own. */
  reportError(message: string): void;
};

/**
 * The capture document: the pages selected, the extraction, the result being
 * reviewed, and the draft that is saved as it goes. It ends where the menu
 * begins — `documentForSave` hands the screen the document to persist, and
 * the editor's own state takes over from there.
 */
export function useCapture(options: CaptureOptions) {
  const { signedIn, accountKey } = useWorkspace();
  const { storageDownRef, refreshLibrary } = useLibrary();

  /** Session answers for async work that finishes after an await. */
  const signedInRef = useRef(signedIn);
  const accountKeyRef = useRef<string | null>(accountKey);
  useEffect(() => {
    signedInRef.current = signedIn;
    accountKeyRef.current = accountKey;
  }, [signedIn, accountKey]);

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

  /** Preview URLs currently shown for `pages` (revoked on swap and unmount). */
  const liveUrlsRef = useRef<string[]>([]);

  // Preview URLs are capture's, so capture releases them: swapping the
  // selection revokes the old ones, and unmounting revokes the last set.
  useEffect(() => {
    return () => {
      liveUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

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
    // Signed-out replacement needs no consent: the single offline draft is
    // superseded once the new capture saves (pruned in autoSaveDraft), and
    // a failed extraction leaves the old draft standing.
    if (signedInRef.current && !(await options.confirmDiscard())) return;
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
    if (signedInRef.current) {
      // The add control only exists while pages are selected, so there is
      // always a previous selection to combine; the guard in confirmDiscard
      // decides whether there is an extraction result worth confirming.
      // Signed-out replacement needs no consent (see selectFiles).
      const confirmMessage =
        `This discards the current extraction result — the images themselves are kept. ` +
        `A new extraction will run on all ${combined.length} images together: the ` +
        `${pages.length} already selected plus ${incoming.length} new ` +
        `${incoming.length === 1 ? "page" : "pages"}. Continue?`;
      if (!(await options.confirmDiscard(confirmMessage))) return;
    }
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
    if (!(await options.confirmDiscard())) return;
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
    options.revealResult();
  }

  /**
   * Read the selected pages. A read that already produced this draft is not
   * repeated implicitly: pressing again replaces the draft (and any review
   * edits) and spends another AI call, so it asks first.
   */
  async function handleExtract() {
    if (phase === "extracting") return;
    if (extracted !== null || resultDoc !== null) {
      const ok = await options.confirmDiscard(
        "Extract again? This replaces the current draft and any review edits, and spends another AI call."
      );
      if (!ok) return;
    }
    void extractFiles(pages.map((page) => page.file));
  }

  async function handleDemo() {
    if (signedInRef.current && !(await options.confirmDiscard())) return;
    clearCapture();
    const doc = createSampleMenuDocument();
    setDemoDoc(doc);
    setResultDoc(doc);
    setInitialReviewCount(
      doc.categories.reduce((sum, c) => sum + c.items.filter(isItemFlagged).length, 0)
    );
    setSource("demo");
    setPhase("done");
    options.revealResult();
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
      // Server-only while signed in: the draft is a cloud copy from the
      // start, so a rename-and-return never sits "in this browser". No
      // local fallback — a failure keeps the in-memory result and the next
      // Extract press retries.
      if (signedInRef.current) {
        const targetId = await options.ensureServerTarget(doc.title);
        if (!targetId) {
          throw new SyncError(
            "unavailable",
            "Couldn't reach your account. Check your connection, then press Extract again."
          );
        }
        let server: ServerMenu;
        try {
          server = await createServerMenu(targetId, doc);
        } catch (serverError) {
          // A retry that landed after an ambiguous failure adopts the row
          // instead of duplicating it.
          if (serverError instanceof SyncError && serverError.code === "exists") {
            server = await fetchServerMenu(doc.id);
          } else {
            throw serverError;
          }
        }
        if (primaryPageBlob) {
          try {
            await saveImage(server.id, primaryPageBlob);
          } catch {
            // Image is optional; the menu matters.
          }
        }
        if (token !== draftTokenRef.current) return;
        const cached = await options.cacheServerDraft(server);
        draftDocRef.current = cached;
        setDraftSave("saved");
        await refreshLibrary();
        return;
      }
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
      await options.pruneSignedOutOthers(saved.id);
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

  /** Rename a dish in place. The name is the fix; the AI's uncertainty
   * about it (reviewNotes) stays until the owner confirms separately. */
  function handleRenameResultItem(loc: ReviewItemLocation, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item || item.name === trimmed) return;
    const next = updateItem(doc, category.id, item.id, { name: trimmed });
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Edit a dish's description in place. Blank clears it (null = not
   * shown); notes stay until the owner confirms separately. */
  function handleUpdateResultDescription(loc: ReviewItemLocation, description: string | null) {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item || item.description === description) return;
    const next = updateItem(doc, category.id, item.id, { description });
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Replace a dish's size rows in place. Sizes carry their own prices,
   * so adding the first one clears a misread single root price to null
   * with it (per-size pricing has a null root by design). Removing the
   * last size re-flags the price honestly; notes stay until confirmed. */
  function handleUpdateResultVariants(
    loc: ReviewItemLocation,
    variants: { name: string; price: number | null }[]
  ) {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item) return;
    const cleaned = variants
      .map((variant) => ({ name: variant.name.trim(), price: variant.price }))
      .filter((variant) => variant.name !== "");
    const next = updateItem(
      doc,
      category.id,
      item.id,
      item.variants.length === 0 && cleaned.length > 0
        ? { variants: cleaned, price: null }
        : { variants: cleaned }
    );
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Move a dish to another category in place. Lands at the end; the
   * review card closes because every index path re-keys. */
  function handleMoveResultItem(loc: ReviewItemLocation, toCategoryIndex: number) {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const target = doc.categories[toCategoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item || !target || target.id === category.id) return;
    const next = moveItemToCategory(doc, category.id, target.id, item.id);
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Delete a dish from the draft in place. The shell confirms before
   * this fires; a published revision may still serve the old dish until
   * the next publish. */
  function handleDeleteResultItem(loc: ReviewItemLocation) {
    const doc = source === "demo" ? demoDoc : resultDoc;
    if (!doc) return;
    const category = doc.categories[loc.categoryIndex];
    const item = category?.items[loc.itemIndex];
    if (!category || !item) return;
    const next = deleteItem(doc, category.id, item.id);
    patchResultDoc(next);
    void persistResultDoc(next);
  }

  /** Add a dish the AI missed with the same fix-it-here fields as a row
   * card. Lands at the end of the category — priced as entered, or unpriced
   * and review-noted when the price stays blank. */
  function handleAddResultItem(categoryIndex: number, draft: NewDishDraft) {
    const trimmed = draft.name.trim();
    if (!trimmed) return;
    const doc = source === "demo" ? demoDoc : resultDoc;
    const category = doc?.categories[categoryIndex];
    if (!doc || !category) return;
    const description = draft.description?.trim() ? draft.description.trim() : null;
    const variants = draft.variants
      .map((variant) => ({ name: variant.name.trim(), price: variant.price }))
      .filter((variant) => variant.name !== "");
    const price = variants.length > 0 ? null : draft.price;
    const next = addItem(doc, category.id, {
      name: trimmed,
      description,
      price,
      variants,
      reviewNotes:
        price === null && variants.every((variant) => variant.price === null)
          ? ["Added by hand — check the price."]
          : [],
    });
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

  /**
   * The signed-out way back. A reload with a browser draft shows a banner on
   * Capture, and resuming restores that draft into the capture result screen —
   * the screen the work happened on — rather than asking for the photo again
   * or sending anyone to a library that no longer exists signed out.
   */
  async function resumeDraft(menuId: string): Promise<MenuDocument | null> {
    try {
      const doc = await getMenu(menuId);
      const image = await getImage(menuId).catch(() => null);
      if (image) {
        const file = new File([image.blob], `${doc.title || "menu"}.jpg`, {
          type: image.mimeType,
        });
        applySelection([file]);
      } else {
        // The draft outlives its source photo: the result is still the work.
        applySelection([]);
      }
      draftDocRef.current = doc;
      setResultDoc(doc);
      setExtracted(null);
      setInitialReviewCount(
        doc.categories.reduce((sum, c) => sum + c.items.filter(isItemFlagged).length, 0)
      );
      setSource("ai");
      setDraftSave("saved");
      setPhase("done");
      return doc;
    } catch {
      options.reportError("Couldn't reopen that draft. Try again in a moment.");
      return null;
    }
  }

  /** Display derives from the canonical docs, falling back to the extraction. */
  const result: PreviewMenu | null = resultDoc ?? demoDoc ?? extracted?.menu ?? null;

  /**
   * The document this capture is about to become, or null when the result is
   * the demo menu. Reuses the autosaved draft so a second press never writes
   * a second record.
   */
  function documentForSave(): { doc: MenuDocument; firstPage: PageImage | null } | null {
    if (!(source === "ai" && (extracted || resultDoc))) return null;
    const firstPage = pages[0] ?? null;
    const doc =
      draftDocRef.current ??
      (extracted
        ? extractedMenuToDocument(extracted.menu, {
            provider: extracted.provider,
            model: extracted.model,
            originalFileName: firstPage?.file.name,
          })
        : resultDoc!);
    return { doc, firstPage };
  }

  /** The draft the current result is saved as, if there is one yet. */
  function draftDocId(): string | null {
    return draftDocRef.current?.id ?? null;
  }

  return {
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
    setFileError,
    setExtractError,
    setPages,
    setPhase,
    applySelection,
    selectFiles,
    addPages,
    replacePageAt,
    removePage,
    clearCapture,
    extractFiles,
    handleExtract,
    handleDemo,
    autoSaveDraft,
    patchResultDoc,
    persistResultDoc,
    handleResolveResultItem,
    handleUpdateResultPrice,
    handleResolveAllResultItems,
    handleRenameResultItem,
    handleUpdateResultDescription,
    handleUpdateResultVariants,
    handleMoveResultItem,
    handleDeleteResultItem,
    handleAddResultItem,
    handleRenameResultTitle,
    resumeDraft,
    documentForSave,
    draftDocId,
  };
}

export type CaptureValue = ReturnType<typeof useCapture>;

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { Collapse } from "@/components/ui/collapse";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addCategory,
  addItem,
  deleteCategory,
  deleteItem,
  deleteItems,
  hasAnyPrice,
  isItemFlagged,
  moveCategory,
  moveItem,
  moveItemToCategory,
  moveItemsToCategory,
  renameCategory,
  setItemImage,
} from "@/features/menu/menu-utils";
import { formatItemPrice } from "@/features/menu/preview-utils";
import {
  findDuplicateGroups,
  duplicateItemIds,
  loadDismissedDuplicateKeys,
  saveDismissedDuplicateKeys,
} from "@/features/menu/duplicates";
import type { MenuCategory, MenuDocument, MenuItem } from "@/features/menu/schema";
import { appendExtractionToDocument } from "@/features/menu/convert";
import {
  isCategoryOpen,
  isItemOpen,
  readFoldState,
  revealItem,
  setCategoriesOpen,
  setItemsOpen,
  toggleCategory,
  toggleItem,
  writeFoldState,
  type FoldState,
} from "@/features/menu/fold";
import { searchMenu } from "@/features/menu/search";
import { dietaryLabelVocabulary } from "@/features/menu/dietary-labels";
import { describeExtractionSource } from "@/features/menu/source-label";
import type { EditorMode } from "@/features/navigation/routes";
import { SUPPORTED_IMAGE_MIME_TYPES, validateImageBatch } from "@/lib/image-constraints";
import { ExtractClientError, extractMenuFromFiles } from "@/lib/extract-client";
import { PrepareImageError, prepareImageForUpload } from "@/lib/prepare-image";
import {
  canRestoreDeleteUndo,
  captureDeleteUndo,
  restoreDeleteUndo,
  type DeleteUndo,
} from "@/features/menu/undo";

import { OrderPagePreview } from "@/components/order/order-page-preview";
import { PhoneFrame } from "@/components/ui/phone-frame";

import { AvailabilityPanel } from "./availability-panel";
import { CommitInput } from "./fields";
import { ItemEditor, type ItemActions } from "./item-editor";
import { PublishPanel, type PublishingControls } from "./publish-panel";

export interface SaveState {
  /**
   * `checking` is the honest third answer while it is unknown where a save
   * will land — the account read has not come back yet (003).
   */
  kind: "saved" | "saving" | "checking" | "error";
  /** Short status: "Saved", or the failure/conflict sentence. */
  message: string;
  /**
   * Where the save went ("Saved in this browser" / "Saved to your account").
   * Shown as a tooltip and to screen readers so the main status stays one
   * word; storage mode is a detail, not a concept to learn.
   */
  detail?: string;
}

interface MenuEditorProps {
  doc: MenuDocument;
  selectedItemId?: string | null;
  /**
   * Which surface is shown (edit workspace, reorder list, customer
   * preview). Owned by the URL so each mode is deep-linkable and works
   * with browser back/forward (see navigation/routes.ts).
   */
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onChange: (next: MenuDocument) => void;
  saveState: SaveState;
  /**
   * Where saves go: "local" = this browser only, "account" = synced to the
   * signed-in account with the local copy as an offline cache (Step 8).
   */
  syncMode: "local" | "account";
  imageUrl: string | null;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportFile: (file: File) => void;
  importError: string | null;
  onDeleteMenu: () => void;
  onBack: () => void;
  /**
   * False when the caller has staff access: owner-only controls (editing
   * modes, publishing) are hidden entirely, not just disabled.
   */
  canManage?: boolean;
  /**
   * True when this menu lives on the server. Table cards are restaurant-wide
   * and print from the Tables tab; this only decides whether opening hours
   * sync to the server copy or stay in this browser.
   *
   * Null when the account's menu list has not answered yet: neither claim is
   * true then, so the copy says it is checking instead (003).
   */
  onServer?: boolean | null;
  /**
   * True when the account's menu read failed. `onServer` is `null` then, but
   * this is an answer, not a wait: the surfaces say the account couldn't be
   * checked and offer a retry, and the café-creating CTA stays off (016).
   */
  accountCheckFailed?: boolean;
  /** Re-runs the account read behind those surfaces. */
  onRetryAccountCheck?: () => void;
  /** The café's name, shown on the diner preview when the account knows it. */
  restaurantName?: string | null;
  /** Open the publish wizard for a browser-only menu (R1). */
  onStartPublish?: () => void;
  /**
   * Publishing state and actions (Step 9). Absent when nothing can publish
   * in this context, in which case the preview simply omits the panel.
   */
  publishing?: PublishingControls;
  /** Fired when the diner preview opens; the page refreshes publish state. */
  onPreviewOpen?: () => void;
}

const smallButton =
  "rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700";

const primaryButton =
  "rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors " +
  "hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700";

const tinyButton =
  "rounded-full border border-stone-300 px-2 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-40";

export function MenuEditor({
  doc,
  selectedItemId = null,
  mode,
  onModeChange,
  onChange,
  saveState,
  syncMode,
  canManage = true,
  onServer = false,
  restaurantName = null,
  accountCheckFailed = false,
  onRetryAccountCheck,
  onStartPublish,
  imageUrl,
  onExportJson,
  onExportCsv,
  onImportFile,
  importError,
  onDeleteMenu,
  onBack,
  publishing,
  onPreviewOpen,
}: MenuEditorProps) {
  const reviewCount = doc.categories.reduce(
    (sum, c) => sum + c.items.filter(isItemFlagged).length,
    0
  );
  // Photos are uploaded under the signed-in session, so a browser-only menu
  // (nobody signed in) cannot attach one yet.
  const canUploadItemImages = canManage && syncMode === "account";
  // Provenance, so a surprising line can be traced to the model that read it.
  const sourceLabel = describeExtractionSource(doc.source);
  // One category list for every row's "Move to" select and one label
  // vocabulary for every row's tag input: both are views over the document, so
  // they are built once here instead of forty-five times per render. Stable
  // identities are also what let the row's memo hold.
  const categoryChoices = useMemo(
    () => doc.categories.map((category) => ({ id: category.id, name: category.name })),
    [doc.categories]
  );
  const labelVocabulary = useMemo(() => dietaryLabelVocabulary([doc]), [doc]);

  // Search box: pure client-side filter, see search.ts for the rules.
  const [query, setQuery] = useState("");
  const search = useMemo(() => searchMenu(doc, query), [doc, query]);
  const isFiltering = query.trim().length > 0;

  // Which dishes have their form open (fold.ts). Remembered per menu, and
  // kept with the menu id it belongs to so switching menus never paints the
  // previous menu's rows first.
  const [fold, setFold] = useState<{ menuId: string; state: FoldState }>(() => ({
    menuId: doc.id,
    state: readFoldState(doc.id),
  }));
  const foldState = fold.menuId === doc.id ? fold.state : readFoldState(doc.id);

  function applyFold(next: FoldState) {
    writeFoldState(doc.id, next);
    setFold({ menuId: doc.id, state: next });
  }

  /** Every section and every dish at once — the two buttons by the search. */
  function setEverythingOpen(open: boolean) {
    const categoryIds = doc.categories.map((category) => category.id);
    const itemIds = doc.categories.flatMap((category) => category.items.map((item) => item.id));
    applyFold(setItemsOpen(setCategoriesOpen(foldState, categoryIds, open), itemIds, open));
  }

  /**
   * Add a dish and open its form, so naming it is the next keystroke instead
   * of a scroll and a click.
   */
  function handleAddItem(categoryId: string) {
    const next = addItem(doc, categoryId, { name: "New item" });
    const created = next.categories.find((c) => c.id === categoryId)?.items;
    const last = created?.[created.length - 1];
    if (last) {
      applyFold(revealItem(foldState, last.id, categoryId));
      setActiveCategoryId(categoryId);
    }
    onChange(next);
  }

  // Category navigation (R0: the One-at-a-time/All toggle is deleted).
  // Phones show one section behind the stepper; larger screens show the full
  // menu and search covers everything. The active category resolves against
  // the visible (search-filtered) list, so a deleted category — or one
  // filtered out of a search — falls back to the first visible category
  // instead of blanking.
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const activeMatch =
    search.categories.find((match) => match.category.id === activeCategoryId) ??
    search.categories[0] ??
    null;
  const activeIndex = Math.max(
    0,
    search.categories.findIndex((match) => match.category.id === activeMatch?.category.id)
  );

  /**
   * True below Tailwind's `sm`, where the page shows one section at a time
   * behind the stepper. There the stepper *is* the fold: a section has no fold
   * of its own, and the chevron that would reopen one is hidden, so the
   * visible section must stay open even when the desktop list left it
   * collapsed. Read from the same width as the `sm:` styles so the two cannot
   * disagree, and guarded so it stays quiet where `matchMedia` does not exist
   * (the server render and the tests).
   */
  const [phoneWidth, setPhoneWidth] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 639.98px)");
    const update = () => setPhoneWidth(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  /** Step through the visible categories from the phone stepper. */
  function stepCategory(delta: 1 | -1) {
    const ids = search.categories.map((match) => match.category.id);
    if (ids.length === 0) return;
    const current = ids.indexOf(activeMatch?.category.id ?? "");
    const next = ids[(current + delta + ids.length) % ids.length];
    if (next) setActiveCategoryId(next);
  }

  useEffect(() => {
    if (!selectedItemId) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(`menu-item-${selectedItemId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    );
    return () => cancelAnimationFrame(frame);
  }, [selectedItemId]);

  // Duplicate review (flags only, never auto-deletes — see duplicates.ts).
  // Dismissals are remembered per document, in session state and localStorage.
  const [dismissedMap, setDismissedMap] = useState<Record<string, string[]>>({});
  // One storage read per document, not one per render: the fallback used to
  // run a JSON.parse on every keystroke and every fold toggle.
  const dismissedKeys = useMemo(
    () => dismissedMap[doc.id] ?? loadDismissedDuplicateKeys(doc.id),
    [dismissedMap, doc.id]
  );
  const duplicateGroups = useMemo(
    () => findDuplicateGroups(doc).filter((group) => !dismissedKeys.includes(group.key)),
    [doc, dismissedKeys]
  );
  const duplicateIds = duplicateItemIds(duplicateGroups);

  function dismissGroup(key: string) {
    const next = dismissedKeys.includes(key) ? dismissedKeys : [...dismissedKeys, key];
    saveDismissedDuplicateKeys(doc.id, next);
    setDismissedMap((prev) => ({ ...prev, [doc.id]: next }));
  }

  // One-level undo for deletions. The snapshot only stays offered while the
  // document still matches the post-delete state — see undo.ts.
  const [undo, setUndo] = useState<DeleteUndo | null>(null);
  const undoLabel = undo && canRestoreDeleteUndo(undo, doc) ? undo.label : null;
  const { confirm, dialog } = useConfirm();

  /** Delete an item, keeping a one-level undo of the document beforehand. */
  async function removeItem(categoryId: string, item: MenuItem) {
    const ok = await confirm({
      message: `Delete “${item.name}”? You can undo this until your next change.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const next = deleteItem(doc, categoryId, item.id);
    setUndo(captureDeleteUndo(doc, next, `deleted “${item.name}”`));
    onChange(next);
  }

  function handleUndo() {
    if (!undo || !canRestoreDeleteUndo(undo, doc)) return;
    setUndo(null);
    onChange(restoreDeleteUndo(undo));
  }

  /** Delete a category (after confirm), keeping undo and the carousel sane. */
  async function handleDeleteCategory(category: MenuCategory, index: number) {
    const ok = await confirm({
      message: `Delete category “${category.name}” and its ${category.items.length} items? You can undo this until your next change.`,
      confirmLabel: "Delete category",
      destructive: true,
    });
    if (!ok) return;
    const next = deleteCategory(doc, category.id);
    setUndo(captureDeleteUndo(doc, next, `deleted category “${category.name}”`));
    // Keep the stepper on the category that takes this one's place (or the
    // new last one); null when the menu is now empty.
    setActiveCategoryId(next.categories[Math.min(index, next.categories.length - 1)]?.id ?? null);
    onChange(next);
  }

  /** Add a category and open it straight away. */
  function handleAddCategory() {
    const next = addCategory(doc, { name: "New category" });
    setActiveCategoryId(next.categories[next.categories.length - 1]?.id ?? null);
    onChange(next);
  }

  // View mode swaps the editing surface for the diner's order page or the
  // compact reorder list, while the header (back, save state) stays put.
  // "edit" is the workspace; "preview" is the read-only order page a table
  // card opens; "reorder" arranges without the editing boxes. The mode lives
  // in the URL (via onModeChange), so each surface has its own link and
  // back/forward moves between them.
  function changeMode(next: EditorMode) {
    if (next === "preview") onPreviewOpen?.();
    onModeChange(next);
  }

  /** The draft is ahead of what table ordering serves right now. */
  const needsPublish =
    publishing?.status?.isLive === true && publishing.status.hasUnpublishedChanges;

  // Bulk reassignment: selection is tracked by item id and pruned against
  // the live document, so deleted or filtered-out items never linger.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const presentIds = new Set(doc.categories.flatMap((c) => c.items.map((i) => i.id)));
  const selected = [...selectedIds].filter((id) => presentIds.has(id));

  function handleBulkMove() {
    if (selected.length === 0 || !bulkTarget) return;
    onChange(moveItemsToCategory(doc, selected, bulkTarget));
    setSelectedIds(new Set());
    setBulkTarget("");
  }

  /** Delete every selected item behind one confirmation and one undo step. */
  async function handleBulkDelete() {
    if (selected.length === 0) return;
    const count = selected.length;
    const ok = await confirm({
      message: `Delete ${count} selected ${count === 1 ? "item" : "items"}? You can undo this until your next change.`,
      confirmLabel: count === 1 ? "Delete item" : `Delete ${count} items`,
      destructive: true,
    });
    if (!ok) return;
    const next = deleteItems(doc, selected);
    setUndo(
      captureDeleteUndo(doc, next, count === 1 ? "deleted 1 item" : `deleted ${count} items`)
    );
    setSelectedIds(new Set());
    onChange(next);
  }

  // The row handlers, created once. They read the live editor state through a
  // ref, so React.memo(ItemEditor) holds: a fold toggle re-renders the one row
  // whose `open` changed and leaves the other forty-four alone.
  const liveRef = useRef({ doc, foldState, onChange, confirm });
  useEffect(() => {
    liveRef.current = { doc, foldState, onChange, confirm };
  }, [doc, foldState, onChange, confirm]);

  const itemActions = useMemo<ItemActions>(
    () => ({
      change: (next) => liveRef.current.onChange(next),
      toggleOpen: (itemId) => {
        const live = liveRef.current;
        const next = toggleItem(live.foldState, itemId);
        writeFoldState(live.doc.id, next);
        setFold({ menuId: live.doc.id, state: next });
      },
      toggleSelected: (itemId) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
      },
      delete: (categoryId, itemId) => {
        void (async () => {
          const item = liveRef.current.doc.categories
            .find((category) => category.id === categoryId)
            ?.items.find((candidate) => candidate.id === itemId);
          if (!item) return;
          const ok = await liveRef.current.confirm({
            message: `Delete “${item.name}”? You can undo this until your next change.`,
            confirmLabel: "Delete",
            destructive: true,
          });
          if (!ok) return;
          // Re-read after the dialog: the document may have moved on meanwhile.
          const latest = liveRef.current.doc;
          const next = deleteItem(latest, categoryId, itemId);
          setUndo(captureDeleteUndo(latest, next, `deleted “${item.name}”`));
          liveRef.current.onChange(next);
        })();
      },
      attachImage: (itemId, image) => {
        const current = liveRef.current.doc;
        const category = current.categories.find((candidate) =>
          candidate.items.some((item) => item.id === itemId)
        );
        if (!category) return;
        liveRef.current.onChange(setItemImage(current, category.id, itemId, image));
      },
    }),
    []
  );

  // Latest document for async completions: an extraction can take a
  // minute, and edits made while it runs must survive the merge.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  // Add pages: photograph more of the same menu later and merge the new
  // extraction in. Repeats are flagged by the duplicate review, never
  // deleted or merged away.
  type AddPagesState =
    | { status: "idle" }
    | { status: "working" }
    | { status: "added"; items: number; categories: number }
    | { status: "error"; message: string };
  const [addPages, setAddPages] = useState<AddPagesState>({ status: "idle" });
  /** The hidden "Add pages" input, carried by the plus box beside the source image. */
  const addPagesInputRef = useRef<HTMLInputElement>(null);

  async function handleAddPages(files: File[]) {
    const check = validateImageBatch(files);
    if (!check.valid) {
      setAddPages({ status: "error", message: check.message });
      return;
    }
    setAddPages({ status: "working" });
    try {
      // Normalize first, mirroring the capture screen: AVIF is transcoded
      // here because the provider cannot read it.
      const prepared = await Promise.all(files.map((file) => prepareImageForUpload(file)));
      const extraction = await extractMenuFromFiles(
        prepared.map((image) => new File([image.blob], image.filename, { type: image.mimeType }))
      );
      if (extraction.menu.categories.length === 0) {
        setAddPages({
          status: "error",
          message: "The new pages added no readable items — nothing changed.",
        });
        return;
      }
      const merged = appendExtractionToDocument(docRef.current, extraction.menu, {
        provider: extraction.provider,
        model: extraction.model,
        originalFileName: files[0]?.name,
      });
      onChange(merged.doc);
      setAddPages({
        status: "added",
        items: merged.addedItems,
        categories: merged.addedCategories,
      });
    } catch (error) {
      setAddPages({
        status: "error",
        message:
          error instanceof ExtractClientError || error instanceof PrepareImageError
            ? error.message
            : "Something went wrong. Try again.",
      });
    }
  }

  const headerRow = (
    <div data-print-hide className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" onClick={onBack} className={smallButton}>
        ← All menus
      </button>
      {undoLabel && (
        <button
          type="button"
          onClick={handleUndo}
          className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:border-amber-700 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          ↩ Undo {undoLabel}
        </button>
      )}
      <div
        role="status"
        title={saveState.detail}
        className={`min-w-0 text-xs font-medium ${saveState.kind === "error" ? "text-danger-700" : "text-ink-500"}`}
      >
        {saveState.kind === "saving" ? (
          <span>
            <span
              aria-hidden="true"
              className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-stone-400 border-t-transparent align-[-2px]"
            />
            Saving…
          </span>
        ) : saveState.kind === "checking" ? (
          <span>
            <span className="sr-only">{saveState.message}</span>
            <Skeleton className="inline-block h-3 w-36 align-[-1px]" />
          </span>
        ) : (
          saveState.message
        )}
        {saveState.detail && <span className="sr-only"> — {saveState.detail}</span>}
      </div>
      <span className="flex-1" />
      {!canManage ? (
        <>
          {mode !== "preview" && (
            <button type="button" onClick={() => changeMode("preview")} className={smallButton}>
              Preview order page
            </button>
          )}
        </>
      ) : mode === "edit" ? (
        <>
          <button type="button" onClick={() => changeMode("reorder")} className={smallButton}>
            ↕ Reorder
          </button>
          <button type="button" onClick={() => changeMode("preview")} className={smallButton}>
            Preview order page
          </button>
        </>
      ) : (
        <button type="button" onClick={() => changeMode("edit")} className={primaryButton}>
          ← Back to edit
        </button>
      )}
    </div>
  );

  if (mode === "preview") {
    return (
      <div className="flex flex-col gap-4">
        {headerRow}
        {publishing && canManage && (
          <PublishPanel
            signedIn={syncMode === "account"}
            controls={publishing}
            draftDoc={doc}
            onStartWizard={onStartPublish}
          />
        )}
        <PhoneFrame
          label="What a table card opens"
          heightClass="h-[min(78vh,860px)]"
          widthClass="max-w-[420px]"
        >
          <OrderPagePreview
            doc={doc}
            restaurantName={restaurantName}
            draftAheadOfLive={needsPublish}
          />
        </PhoneFrame>
      </div>
    );
  }

  if (mode === "reorder") {
    return (
      <div className="flex flex-col gap-4">
        {headerRow}
        <div className="rounded-2xl border border-stone-200 bg-surface-base p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold text-ink-900">Reorder items</h2>
            <p className="text-xs text-ink-500">
              A compact list for arranging — the full editing boxes stay on the edit screen.
              {isFiltering && " Search is paused here; every item is shown."}
            </p>
          </div>
          {doc.categories.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">
              No categories yet — add one on the edit screen.
            </p>
          ) : (
            <ol className="mt-3 space-y-4">
              {doc.categories.map((category, categoryIndex) => (
                <li
                  key={category.id}
                  className="overflow-hidden rounded-xl border border-stone-200"
                >
                  <div className="flex items-center gap-1.5 border-b border-stone-100 bg-surface-50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
                      {category.name || "Untitled category"}
                      <span className="ml-2 font-normal text-ink-500">
                        {category.items.length} {category.items.length === 1 ? "item" : "items"}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={categoryIndex <= 0}
                      onClick={() => onChange(moveCategory(doc, category.id, categoryIndex - 1))}
                      aria-label={`Move ${category.name || "category"} up`}
                      className={tinyButton}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={categoryIndex >= doc.categories.length - 1}
                      onClick={() => onChange(moveCategory(doc, category.id, categoryIndex + 1))}
                      aria-label={`Move ${category.name || "category"} down`}
                      className={tinyButton}
                    >
                      ↓
                    </button>
                  </div>
                  {category.items.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-ink-500">No items.</p>
                  ) : (
                    <ol>
                      {category.items.map((item, index) => {
                        const label = item.name.trim() ? item.name : "Untitled item";
                        return (
                          <li
                            key={item.id}
                            className="flex items-center gap-1.5 border-b border-stone-100 px-3 py-1.5 last:border-0"
                          >
                            <span
                              aria-hidden="true"
                              className="w-6 shrink-0 text-right text-xs text-ink-400"
                            >
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                              {label}
                            </span>
                            {duplicateIds.has(item.id) && (
                              <span
                                title="This name appears more than once — see the duplicate review on the edit screen."
                                className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
                              >
                                duplicate
                              </span>
                            )}
                            {item.reviewNotes.length > 0 && (
                              <span
                                title={item.reviewNotes.join("\n")}
                                className="shrink-0 rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-ink-600"
                              >
                                {hasAnyPrice(item) ? "couldn't read" : "check price"}
                              </span>
                            )}
                            <span className="shrink-0 text-xs whitespace-nowrap text-ink-500">
                              {formatItemPrice(item, doc.currency)}
                            </span>
                            <button
                              type="button"
                              disabled={index <= 0}
                              onClick={() =>
                                onChange(moveItem(doc, category.id, item.id, index - 1))
                              }
                              aria-label={`Move ${label} up`}
                              className={tinyButton}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={index >= category.items.length - 1}
                              onClick={() =>
                                onChange(moveItem(doc, category.id, item.id, index + 1))
                              }
                              aria-label={`Move ${label} down`}
                              className={tinyButton}
                            >
                              ↓
                            </button>
                            {doc.categories.length > 1 && (
                              <select
                                aria-label={`Move ${label} to another category`}
                                defaultValue=""
                                onChange={(event) => {
                                  if (event.target.value) {
                                    onChange(
                                      moveItemToCategory(
                                        doc,
                                        category.id,
                                        event.target.value,
                                        item.id,
                                        index
                                      )
                                    );
                                    event.target.value = "";
                                  }
                                }}
                                className="shrink-0 rounded-full border border-stone-300 bg-surface-base px-2 py-1 text-xs text-ink-700 focus:border-amber-700 focus:outline-none"
                              >
                                <option value="">Move to…</option>
                                {doc.categories
                                  .filter((c) => c.id !== category.id)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name || "Untitled category"}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {headerRow}
      <div className="rounded-2xl border border-stone-200 bg-surface-base px-4 py-3 text-xs leading-5 text-ink-600">
        {onStartPublish && accountCheckFailed ? (
          <p>
            We couldn&apos;t check your account just now, so publishing is paused.{" "}
            {onRetryAccountCheck && (
              <button
                type="button"
                onClick={onRetryAccountCheck}
                className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                Try again
              </button>
            )}
            {onRetryAccountCheck ? "." : null}
          </p>
        ) : onStartPublish && onServer === null ? (
          <div role="status" aria-busy="true">
            <span className="sr-only">Checking where this menu is saved…</span>
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : onStartPublish && onServer === false ? (
          <p>
            Once your menu is set,{" "}
            <button
              type="button"
              onClick={onStartPublish}
              className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              set up table ordering
            </button>{" "}
            — we create your café if you don&apos;t have one yet. Or{" "}
            <button
              type="button"
              onClick={() => changeMode("preview")}
              className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              preview the order page
            </button>
            .
          </p>
        ) : (
          <p>
            Once your menu is set,{" "}
            <button
              type="button"
              onClick={() => changeMode("preview")}
              className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              go to Preview
            </button>{" "}
            to publish it for your tables.
          </p>
        )}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-surface-base p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <CommitInput
              label="Menu title"
              value={doc.title}
              onCommit={(title) => onChange({ ...doc, title: title.trim() })}
            />
            <CommitInput
              label="Currency"
              value={doc.currency ?? ""}
              validate={() => null}
              placeholder="e.g. USD"
              onCommit={(currency) =>
                onChange({ ...doc, currency: currency.trim() ? currency.trim() : null })
              }
            />
          </div>
          {sourceLabel &&
            (doc.source?.provider === "demo" ? (
              <p className="mt-2 inline-block rounded-full bg-info-100 px-2.5 py-0.5 text-xs font-semibold text-info-900">
                Demo data
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-500">
                {sourceLabel}
                {doc.source?.originalFileName && (
                  <span className="text-ink-400"> · {doc.source.originalFileName}</span>
                )}
              </p>
            ))}
          {(imageUrl || canManage) && (
            <div className="mt-3">
              {imageUrl && <p className="mb-1 text-xs font-medium text-ink-500">Source image</p>}
              <div className="flex items-stretch gap-3">
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Original uploaded menu"
                    className="max-h-28 w-auto self-center rounded-lg border border-stone-200 object-contain"
                  />
                )}
                {canManage && (
                  <label
                    className={`flex min-w-36 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-stone-300 bg-surface-50 px-4 py-2 text-center transition-colors hover:border-amber-700 hover:bg-amber-50 focus-within:border-amber-700 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-amber-700 ${addPages.status === "working" ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className="text-xl leading-none font-bold text-ink-500"
                    >
                      +
                    </span>
                    <span className="text-xs font-semibold text-ink-700">
                      {addPages.status === "working" ? "Reading pages…" : "Add pages"}
                    </span>
                    <span className="text-[11px] leading-4 text-ink-500">
                      Photograph more pages of this menu to add their items
                    </span>
                    <input
                      ref={addPagesInputRef}
                      type="file"
                      multiple
                      accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                      className="sr-only"
                      disabled={addPages.status === "working"}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = "";
                        if (files.length > 0) void handleAddPages(files);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          )}
          {reviewCount > 0 && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              {reviewCount} {reviewCount === 1 ? "item" : "items"} to check below.
            </p>
          )}
        </div>
        <AvailabilityPanel
          key={doc.id}
          menuId={doc.id}
          // Opening hours live with the menu in your account: a browser-only
          // menu has no availability row to fetch, account mode or not.
          syncMode={onServer ? "account" : "local"}
          canManage={canManage}
        />
      </div>
      {duplicateGroups.length > 0 && (
        <section
          aria-label="Possible duplicates"
          className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">
            {duplicateGroups.length === 1
              ? "1 possible duplicate found — review it; nothing is deleted automatically."
              : `${duplicateGroups.length} possible duplicates found — review them; nothing is deleted automatically.`}
          </p>
          <ul className="mt-3 space-y-3">
            {duplicateGroups.map((group) => (
              <li key={group.key} className="rounded-xl border border-amber-200 bg-surface-base p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    “{group.displayName}” appears {group.occurrences.length} times
                  </p>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => dismissGroup(group.key)}
                    className={smallButton}
                  >
                    Keep all
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {group.occurrences.map((occurrence) => (
                    <li
                      key={occurrence.item.id}
                      className="flex flex-wrap items-center gap-2 text-sm text-ink-700"
                    >
                      <span className="min-w-[160px] flex-1">
                        {occurrence.item.name}
                        <span className="text-xs text-ink-500">
                          {" "}
                          in {occurrence.categoryName}
                          {occurrence.item.price !== null &&
                            ` · ${occurrence.item.currency ?? doc.currency ?? ""}${occurrence.item.price}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(occurrence.categoryId, occurrence.item)}
                        className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                      >
                        Delete this copy
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-surface-base p-3">
        <label htmlFor="menu-search" className="sr-only">
          Search the menu
        </label>
        <input
          id="menu-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) setQuery("");
          }}
          placeholder="Search items, descriptions, or categories…"
          className="min-w-[200px] flex-1 rounded-full border border-stone-300 bg-surface-base px-4 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-amber-700 focus:outline-none"
        />
        {isFiltering && (
          <button type="button" onClick={() => setQuery("")} className={smallButton}>
            Clear
          </button>
        )}
        <p role="status" className="text-xs font-medium text-ink-500">
          {isFiltering
            ? `${search.matchCount} of ${search.totalItems} ${search.totalItems === 1 ? "item" : "items"}`
            : `${search.totalItems} ${search.totalItems === 1 ? "item" : "items"}`}
        </p>
        {doc.categories.length > 0 && (
          <div className="flex items-center gap-2">
            {/* Below `sm` a section cannot fold — the stepper is the fold — so
                only the dish forms answer here, and the label says which. */}
            <button type="button" onClick={() => setEverythingOpen(true)} className={smallButton}>
              <span className="sm:hidden">Open every dish</span>
              <span className="hidden sm:inline">Expand all</span>
            </button>
            <button type="button" onClick={() => setEverythingOpen(false)} className={smallButton}>
              <span className="sm:hidden">Close every dish</span>
              <span className="hidden sm:inline">Collapse all</span>
            </button>
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-0 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50/95 p-3 shadow-sm backdrop-blur"
        >
          <p className="text-xs font-semibold text-amber-900">
            {selected.length} {selected.length === 1 ? "item" : "items"} selected
          </p>
          <label className="flex items-center gap-1.5 text-xs text-amber-900">
            Move to
            <select
              aria-label="Category to move selected items to"
              value={bulkTarget}
              onChange={(event) => setBulkTarget(event.target.value)}
              className="rounded-full border border-stone-300 bg-surface-base px-2 py-1 text-xs text-ink-700 focus:border-amber-700 focus:outline-none"
            >
              <option value="">Category…</option>
              {doc.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!bulkTarget}
            onClick={handleBulkMove}
            className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Move selected
          </button>
          <button
            type="button"
            onClick={() => void handleBulkDelete()}
            className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
          >
            Delete selected
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className={smallButton}>
            Clear
          </button>
        </div>
      )}
      {doc.categories.length > 0 && search.categories.length > 0 && activeMatch && (
        <div
          className={`z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur-sm sm:hidden ${
            selected.length === 0 ? "sticky top-0" : ""
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepCategory(-1)}
              aria-label="Previous category"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-300 bg-surface-base text-lg font-bold text-ink-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              ‹
            </button>
            <label className="flex min-h-[44px] min-w-0 flex-1 items-center">
              <span className="sr-only">Category</span>
              <select
                value={activeMatch.category.id}
                onChange={(event) => setActiveCategoryId(event.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-surface-base px-3 py-2.5 text-sm font-semibold text-ink-900 focus:border-amber-700 focus:outline-none"
              >
                {search.categories.map(({ category, items }) => (
                  <option key={category.id} value={category.id}>
                    {category.name} ({items.length})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => stepCategory(1)}
              aria-label="Next category"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-300 bg-surface-base text-lg font-bold text-ink-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              ›
            </button>
          </div>
          <p className="mt-1 text-center text-xs text-ink-500">
            Category {activeIndex + 1} of {search.categories.length}
          </p>
        </div>
      )}
      {doc.categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-surface-base p-8 text-center">
          <p className="font-medium text-ink-900">No categories yet</p>
          <p className="mt-1 text-sm text-ink-600">Add a category below, then add items to it.</p>
        </div>
      ) : search.categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-surface-base p-8 text-center">
          <p className="font-medium text-ink-900">No items match “{query.trim()}”</p>
          <p className="mt-1 text-sm text-ink-600">
            {search.totalItems} {search.totalItems === 1 ? "item" : "items"} in this menu.
          </p>
          <button type="button" onClick={() => setQuery("")} className={`${smallButton} mt-3`}>
            Clear search
          </button>
        </div>
      ) : (
        search.categories.map(({ category, items }) => {
          const index = doc.categories.findIndex((c) => c.id === category.id);
          // R0: phones show the stepper's category only, always open (see
          // `phoneWidth`); sm+ shows every section with its own fold.
          const phoneOnly = category.id === activeMatch?.category.id ? "" : "hidden sm:block ";
          // Searching always shows what it found: a match inside a collapsed
          // section would be a result the page refuses to reveal.
          const categoryOpen = isFiltering || phoneWidth || isCategoryOpen(foldState, category.id);
          const categoryPanelId = `menu-category-panel-${category.id}`;
          const toCheck = items.filter(isItemFlagged).length;
          return (
            <section
              key={category.id}
              aria-label={`Category ${category.name}`}
              className={`${phoneOnly}overflow-hidden rounded-2xl border border-stone-200 bg-surface-base`}
            >
              {/* The band says what the section is and how much is in it, and
                  holds its own actions — so a collapsed section is still
                  legible and still manageable. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-stone-200 bg-surface-100 px-3 py-2">
                <button
                  type="button"
                  onClick={() => applyFold(toggleCategory(foldState, category.id))}
                  disabled={isFiltering}
                  aria-expanded={categoryOpen}
                  aria-controls={categoryOpen ? categoryPanelId : undefined}
                  title={
                    isFiltering
                      ? "Search shows every matching section"
                      : categoryOpen
                        ? "Collapse this section"
                        : "Expand this section"
                  }
                  className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-surface-base text-sm text-ink-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-40 sm:flex"
                >
                  {categoryOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </button>
                <div className="min-w-[9rem] flex-1">
                  <CommitInput
                    label={`Category ${index + 1}`}
                    value={category.name}
                    hideLabel
                    inputClassName="border-transparent bg-transparent px-1 py-1 text-base font-semibold hover:border-stone-300 focus:border-amber-700 focus:bg-surface-base"
                    onCommit={(name) => onChange(renameCategory(doc, category.id, name.trim()))}
                  />
                </div>
                <p className="shrink-0 text-xs text-ink-500">
                  {items.length} {items.length === 1 ? "item" : "items"}
                  {toCheck > 0 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                      {toCheck} to check
                    </span>
                  )}
                </p>
                {/* Inline reordering shows only where the list does. A phone
                    shows one section at a time, so ↑ moved a category the
                    owner could not watch move, right beside the stepper's
                    ‹ › — two axes, one apparent control. Arranging on a phone
                    belongs to the reorder view, which lists every category. */}
                <div className="hidden shrink-0 items-center gap-1 sm:flex">
                  <button
                    type="button"
                    aria-label={`Move ${category.name} up`}
                    disabled={index === 0}
                    onClick={() => onChange(moveCategory(doc, category.id, index - 1))}
                    className={tinyButton}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${category.name} down`}
                    disabled={index === doc.categories.length - 1}
                    onClick={() => onChange(moveCategory(doc, category.id, index + 1))}
                    className={tinyButton}
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(category, index)}
                  className={`${tinyButton} hover:border-danger-700 hover:text-danger-800`}
                >
                  Delete
                </button>
              </div>
              <Collapse open={categoryOpen}>
                <div id={categoryPanelId} className="p-4">
                  {items.length === 0 ? (
                    <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-surface-base px-4 py-3 text-center text-sm text-ink-500">
                      No items — add the first one below.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {items.map((item) => (
                        <ItemEditor
                          key={item.id}
                          isRouteTarget={selectedItemId === item.id}
                          // A pasted /menus/<id>/items/<itemId> link opens the
                          // dish without rewriting what the owner folded.
                          open={isItemOpen(foldState, item.id) || item.id === selectedItemId}
                          doc={doc}
                          categoryId={category.id}
                          item={item}
                          categories={categoryChoices}
                          actions={itemActions}
                          labelVocabulary={labelVocabulary}
                          duplicate={duplicateIds.has(item.id)}
                          selected={selectedIds.has(item.id)}
                          canUploadImage={canUploadItemImages}
                        />
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAddItem(category.id)}
                    className={`${smallButton} mt-3`}
                  >
                    + Add item
                  </button>
                </div>
              </Collapse>
            </section>
          );
        })
      )}
      <button
        type="button"
        onClick={handleAddCategory}
        className="rounded-2xl border-2 border-dashed border-stone-300 bg-surface-base px-4 py-3 text-sm font-medium text-ink-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
      >
        + Add category
      </button>
      <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-surface-base p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Menu</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onExportJson} className={smallButton}>
            Export JSON
          </button>
          <button type="button" onClick={onExportCsv} className={smallButton}>
            Export CSV
          </button>
          <label
            className={`${smallButton} inline-flex cursor-pointer items-center pointer-coarse:min-h-[44px]`}
          >
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <span aria-hidden="true" className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              message: `Delete “${doc.title}” permanently from this browser? Export a JSON backup first if it matters.`,
              confirmLabel: "Delete menu",
              destructive: true,
            });
            if (ok) onDeleteMenu();
          }}
          className="self-start rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700 sm:self-auto"
        >
          Delete menu
        </button>
      </div>
      {importError && (
        <p
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          {importError}
        </p>
      )}
      {addPages.status === "working" && (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Reading the new pages… keep this tab open. Your edits are safe.
        </p>
      )}
      {addPages.status === "added" && (
        <p
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          Added {addPages.items} {addPages.items === 1 ? "item" : "items"} in {addPages.categories}{" "}
          {addPages.categories === 1 ? "category" : "categories"} from the new pages. Repeats with
          the existing menu appear in the duplicate review.
        </p>
      )}
      {addPages.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          {addPages.message}
        </p>
      )}{" "}
      <div className="text-xs leading-5 text-ink-500">
        {onServer === null && accountCheckFailed ? (
          <p>
            This browser has your menu saved. We couldn&apos;t check your account just now, so it
            may also be there — nothing was lost either way.{" "}
            {onRetryAccountCheck && (
              <button
                type="button"
                onClick={onRetryAccountCheck}
                className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                Try again
              </button>
            )}
          </p>
        ) : onServer === null ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">
              Checking where this menu is saved. Your edits are saved either way.
            </span>
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <p>
            {onServer
              ? "This menu is saved to your account, so signing in on another device shows the same menu. This browser keeps a copy for offline edits."
              : syncMode === "account"
                ? "This menu is saved in this browser only. Add it to your account to use it on other devices, or export a JSON backup."
                : "This menu is saved in this browser only — it doesn't appear on other devices. Sign in to save it to your account, or export a JSON backup."}
          </p>
        )}
      </div>
      {dialog}
    </div>
  );
}

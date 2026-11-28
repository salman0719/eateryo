"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { ScrollArrowStrip } from "@/components/ui/scroll-arrow-strip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addCategory,
  addItem,
  deleteCategory,
  deleteItem,
  deleteItems,
  duplicateItem,
  hasAnyPrice,
  isItemFlagged,
  moveCategory,
  moveItem,
  moveItemsToCategory,
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
  adjacentItemId,
  readSelection,
  resolveSelection,
  selectCategory,
  selectItem,
  writeSelection,
  type EditorSelection,
} from "@/features/menu/editor-selection";
import { flatSearchRows, searchMenu, type SearchResultRow } from "@/features/menu/search";
import { CategoryHeader } from "./category-header";
import { CategoryPills, SearchResultsList } from "./category-pills";
import { CategoryStrip } from "./category-strip";
import { DuplicateReview } from "./duplicate-review";
import { describeExtractionSource } from "@/features/menu/source-label";
import type { EditorMode } from "@/features/navigation/routes";
import {
  defaultEditorSubTab,
  editorTabCounts,
  readEditorSubTab,
  readReorderCategory,
  readReorderScope,
  writeEditorSubTab,
  writeReorderCategory,
  writeReorderScope,
  type EditorSubTab,
  type ReorderScope,
} from "@/features/menu/editor-tabs";
import { dropInsertIndex, type DropEdge } from "@/features/menu/reorder";
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
import { PreviewBrandBar } from "./preview-brand-bar";

import { AvailabilityPanel } from "./availability-panel";
import { CommitInput } from "./fields";
import { DishRow, type DishRowActions } from "./dish-row";
import { ItemInspector } from "./item-inspector";
import { ModifiersPanel } from "./modifiers-panel";
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
   * signed-in account, with the browser holding a working copy until
   * sign-out (Step 8).
   */
  syncMode: "local" | "account";
  imageUrl: string | null;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportFile: (file: File) => void;
  importError: string | null;
  onDeleteMenu: () => void;
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
  /** Brand assets, shown on the diner preview when the account knows them. */
  restaurantLogo?: import("@/features/brand-assets/schema").BrandAssetImage | null;
  restaurantCover?: import("@/features/brand-assets/schema").BrandAssetImage | null;
  /**
   * The café these assets belong to. Present when the menu lives in an
   * account café; absent for a browser-only menu, which has no café to
   * brand — the preview then shows no Change buttons.
   */
  restaurantId?: string | null;
  /** Files the server's answer after a preview upload, so the header updates. */
  onBrandChanged?: (updated: import("@/features/tenancy/client").RestaurantOption) => void;
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
  "rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

const tinyButton =
  "rounded-full border border-line-300 px-2 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent-700 disabled:cursor-not-allowed disabled:opacity-40";

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
  restaurantLogo = null,
  restaurantCover = null,
  restaurantId = null,
  onBrandChanged,
  accountCheckFailed = false,
  onRetryAccountCheck,
  onStartPublish,
  imageUrl,
  onExportJson,
  onExportCsv,
  onImportFile,
  importError,
  onDeleteMenu,
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

  // Search box: pure client-side filter, see search.ts for the rules.
  const [query, setQuery] = useState("");
  const search = useMemo(() => searchMenu(doc, query), [doc, query]);
  const isFiltering = query.trim().length > 0;
  const flatRows = useMemo(() => flatSearchRows(doc, query), [doc, query]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // "/" focuses the search wherever the editor is showing it; typing in a
  // field is never hijacked. The input only exists in Categories, so the
  // ref is null (and this a no-op) anywhere else.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!searchInputRef.current) return;
      searchInputRef.current.focus();
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /**
   * The Categories tab's selection (editor-selection.ts): one category on the
   * canvas and one dish in the inspector. Remembered per menu like the
   * sub-tab, seeded by a dish deep link, and resolved against the live
   * document on every render — a deleted dish or category can never leave the
   * tab pointing at nothing.
   */
  const selectionKey = `${doc.id}::${selectedItemId ?? ""}`;
  const [selectionOverride, setSelectionOverride] = useState<{
    key: string;
    value: EditorSelection;
  } | null>(null);
  const selection =
    selectionOverride && selectionOverride.key === selectionKey
      ? resolveSelection(doc, selectionOverride.value)
      : selectedItemId
        ? selectItem(doc, selectedItemId)
        : resolveSelection(doc, readSelection(doc.id));

  function applySelection(next: EditorSelection) {
    writeSelection(doc.id, next);
    setSelectionOverride({ key: selectionKey, value: next });
  }

  /** A tab names its category: clear the search so the tab shows it whole. */
  function handleCategorySelect(categoryId: string) {
    setQuery("");
    applySelection(selectCategory(doc, categoryId));
  }

  /** A search result shows its dish in its own category, inspector and all. */
  function handleResultPick(row: SearchResultRow) {
    setQuery("");
    applySelection(selectItem(doc, row.item.id));
  }

  /**
   * Add a dish and select it, so naming it is the next keystroke instead of a
   * scroll and a click.
   */
  function handleAddItem(categoryId: string) {
    const next = addItem(doc, categoryId, { name: "New item" });
    const created = next.categories.find((c) => c.id === categoryId)?.items;
    const last = created?.[created.length - 1];
    onChange(next);
    if (last) applySelection({ categoryId, itemId: last.id });
  }

  /** The category on the canvas, and what its band needs to say. */
  const selectedCategory =
    doc.categories.find((category) => category.id === selection.categoryId) ?? null;
  const selectedCategoryIndex = selectedCategory
    ? doc.categories.findIndex((category) => category.id === selectedCategory.id)
    : -1;
  const selectedToCheck = selectedCategory
    ? selectedCategory.items.filter(isItemFlagged).length
    : 0;
  /** The dish in the inspector (the selection always names a live one). */
  const selectedItem =
    selectedCategory && selection.itemId
      ? (selectedCategory.items.find((item) => item.id === selection.itemId) ?? null)
      : null;
  const selectedItemIndex =
    selectedItem && selectedCategory
      ? selectedCategory.items.findIndex((item) => item.id === selectedItem.id)
      : -1;

  /** Close the inspector, leaving its category on the canvas. */
  function closeInspector() {
    applySelection({ categoryId: selection.categoryId, itemId: null });
  }

  /** The next dish in this category (wrapping) — the inspector's review step. */
  function nextDish() {
    if (!selectedCategory || !selectedItem) return;
    const nextId = adjacentItemId(doc, selectedCategory.id, selectedItem.id, 1);
    if (nextId) applySelection({ categoryId: selectedCategory.id, itemId: nextId });
  }

  // Duplicate review (flags only, never auto-deletes — see duplicates.ts).
  // Dismissals are remembered per document, in session state and localStorage.
  const [dismissedMap, setDismissedMap] = useState<Record<string, string[]>>({});
  // One storage read per document, not one per render: the fallback used to
  // run a JSON.parse on every keystroke and every selection change.
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
    applySelection(
      resolveSelection(next, {
        categoryId: next.categories[Math.min(index, next.categories.length - 1)]?.id ?? null,
        itemId: null,
      })
    );
    onChange(next);
  }

  /** Add a category and open it straight away. */
  function handleAddCategory() {
    const next = addCategory(doc, { name: "New category" });
    const created = next.categories[next.categories.length - 1];
    if (created) applySelection({ categoryId: created.id, itemId: null });
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

  // Sub-tabs inside edit mode (redesign step 2): Settings & hours,
  // Categories, and Add-on sets switch client state; Reorder and Preview
  // are URL modes and navigate as before. The entry rule picks the first
  // tab per menu — a pasted dish link always opens Categories — and the
  // choice is remembered per menu like fold state.
  // The entry rule re-runs when the menu (or dish link) changes; a manual
  // tab switch overrides it until then. Derived during render, so no effect
  // or render-phase setState is needed and the first paint is already right.
  const entryTab =
    selectedItemId !== null && selectedItemId !== undefined
      ? ("categories" as const)
      : (readEditorSubTab(doc.id) ?? defaultEditorSubTab(doc));
  const tabKey = `${doc.id}::${selectedItemId ?? ""}`;
  const [tabOverride, setTabOverride] = useState<{ key: string; tab: EditorSubTab } | null>(null);
  const subTab = tabOverride && tabOverride.key === tabKey ? tabOverride.tab : entryTab;

  function goSubTab(next: EditorSubTab) {
    if (mode !== "edit") changeMode("edit");
    setTabOverride({ key: tabKey, tab: next });
    writeEditorSubTab(doc.id, next);
  }

  // Reorder scope + category (redesign step 11): Categories arranges the
  // whole list, Items arranges the dishes inside one category picked from
  // the pills. Remembered per menu like fold state, so switching menus
  // restores each menu's arrangement view; a stored category the document
  // no longer holds falls back to the first category. Derived during
  // render like the sub-tab, so the first paint is already right.
  const [reorderOverride, setReorderOverride] = useState<{
    key: string;
    scope: ReorderScope;
    categoryId: string | null;
  } | null>(null);
  const reorderScope: ReorderScope =
    reorderOverride && reorderOverride.key === doc.id
      ? reorderOverride.scope
      : (readReorderScope(doc.id) ?? "categories");
  const storedReorderCategory =
    reorderOverride && reorderOverride.key === doc.id
      ? reorderOverride.categoryId
      : readReorderCategory(doc.id);
  const activeReorderCategory =
    doc.categories.find((category) => category.id === storedReorderCategory) ??
    doc.categories[0] ??
    null;

  function chooseReorder(scope: ReorderScope, categoryId: string | null) {
    setReorderOverride({ key: doc.id, scope, categoryId });
    writeReorderScope(doc.id, scope);
    if (categoryId) writeReorderCategory(doc.id, categoryId);
  }

  // HTML5 drag-and-drop for the Reorder tab (redesign step 11): rows carry
  // a grip, the row under the pointer shows an accent insertion line above
  // or below it, and the drop commits through the move helpers — the same
  // commit the steppers make, so the save state updates the same way.
  // Steppers stay on every row as the touch and keyboard path (SPEC §7).
  // Only our own rows are droppable: anything else (e.g. files) is left
  // for the browser, and a foreign row id never reaches the drop math.
  const ROW_MIME = "text/menu-row";
  const [dropTarget, setDropTarget] = useState<{
    overId: string;
    edge: DropEdge;
  } | null>(null);

  function startRowDrag(event: DragEvent<HTMLLIElement>, id: string) {
    event.dataTransfer.setData(ROW_MIME, id);
    event.dataTransfer.effectAllowed = "move";
  }

  function rowEdge(event: DragEvent<HTMLLIElement>): DropEdge {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function overRow(event: DragEvent<HTMLLIElement>, id: string) {
    if (!event.dataTransfer.types.includes(ROW_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const edge = rowEdge(event);
    setDropTarget((prev) =>
      prev && prev.overId === id && prev.edge === edge ? prev : { overId: id, edge }
    );
  }

  function endRowDrag() {
    setDropTarget(null);
  }

  function dropLine(id: string, edge: DropEdge) {
    return dropTarget && dropTarget.overId === id && dropTarget.edge === edge ? (
      <div aria-hidden="true" className="mx-3 h-0.5 rounded-full bg-accent-700" />
    ) : null;
  }

  function dropCategoryRow(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(ROW_MIME);
    setDropTarget(null);
    const ids = doc.categories.map((category) => category.id);
    if (!draggedId || !ids.includes(draggedId)) return;
    const at = dropInsertIndex(ids, draggedId, targetId, rowEdge(event));
    if (at !== null) onChange(moveCategory(doc, draggedId, at));
  }

  function dropItemRow(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(ROW_MIME);
    setDropTarget(null);
    if (!activeReorderCategory) return;
    const ids = activeReorderCategory.items.map((item) => item.id);
    if (!draggedId || !ids.includes(draggedId)) return;
    const at = dropInsertIndex(ids, draggedId, targetId, rowEdge(event));
    if (at !== null) onChange(moveItem(doc, activeReorderCategory.id, draggedId, at));
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
  // ref, so React.memo(DishRow) holds: selecting a dish re-renders the two
  // rows whose highlight changed and leaves the other forty-four alone.
  const liveRef = useRef({ doc, selection, selectionKey, onChange, confirm });
  useEffect(() => {
    liveRef.current = { doc, selection, selectionKey, onChange, confirm };
  }, [doc, selection, selectionKey, onChange, confirm]);

  const rowActions = useMemo<DishRowActions>(
    () => ({
      select: (itemId) => {
        const live = liveRef.current;
        const next = selectItem(live.doc, itemId);
        writeSelection(live.doc.id, next);
        setSelectionOverride({ key: live.selectionKey, value: next });
      },
      toggleSelected: (itemId) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
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

  // One tab strip for every mode, and the first row of the editor: the tabs
  // are the way in and out of preview and reorder, so no separate "Back to
  // edit" is needed above them, and the way out to the library is the shell's
  // own (the sidebar, the phone tab bar), not a line of chrome here. The save
  // status and the delete undo ride at the strip's trailing edge, one glance
  // wide instead of a row above the work. Staff never saw the
  // Reorder/Add-on-sets buttons, so those tabs stay owner-only too.
  const tabCounts = editorTabCounts(doc);
  const countPill = (count: number) => (
    <span className="rounded-full bg-surface-100 px-1.5 text-[11px] font-semibold text-ink-600">
      {count}
    </span>
  );
  const tabStrip = (
    <div
      data-print-hide
      className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-line-200"
    >
      <ScrollArrowStrip as="tablist" label="Menu sections">
        <EditorTab
          label="Settings & hours"
          selected={mode === "edit" && subTab === "settings"}
          onSelect={() => goSubTab("settings")}
        />
        <EditorTab
          label="Categories"
          selected={mode === "edit" && subTab === "categories"}
          onSelect={() => goSubTab("categories")}
          badge={
            <>
              {countPill(tabCounts.dishes)}
              {tabCounts.toCheck > 0 && (
                <span className="rounded-full border border-warning-300 bg-warning-50 px-1.5 text-[11px] font-bold text-warning-900">
                  {tabCounts.toCheck} to check
                </span>
              )}
            </>
          }
        />
        {canManage && (
          <EditorTab
            label="↕ Reorder"
            selected={mode === "reorder"}
            onSelect={() => changeMode("reorder")}
          />
        )}
        <EditorTab
          label="Preview order page"
          selected={mode === "preview"}
          onSelect={() => changeMode("preview")}
        />
        {canManage && (
          <EditorTab
            label="Add-on sets"
            selected={mode === "edit" && subTab === "addons"}
            onSelect={() => goSubTab("addons")}
            badge={tabCounts.sets > 0 ? countPill(tabCounts.sets) : undefined}
          />
        )}
      </ScrollArrowStrip>
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 pb-1.5">
        {undoLabel && (
          <button
            type="button"
            onClick={handleUndo}
            className="rounded-full border border-warning-300 bg-warning-50 px-3 py-1 text-xs font-medium text-accent-900 transition-colors hover:border-accent-700 hover:bg-accent-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            ↩ Undo {undoLabel}
          </button>
        )}
        <SaveStatus state={saveState} className="hidden sm:flex" />
      </div>
    </div>
  );

  if (mode === "preview") {
    // The publish rail is for an owner who has something to publish. A staff
    // preview keeps the page alone, banner included, because there is no
    // action to put beside it.
    const showPublishRail = Boolean(publishing && canManage);
    return (
      <div className="flex flex-col gap-4">
        {tabStrip}
        {/*
        From `lg` the preview stops being a phone island centred in a wide
        column: the page keeps a phone's width and its publish state becomes a
        sticky rail beside it. Below `lg` the same two blocks stack — panel
        first, page under it — which is the layout this tab always had. The
        panel is rendered once and ordered by CSS, so the rail and the stacked
        card can never disagree about the menu's state.

        The pair is centred as one cluster and the phone track is capped at a
        phone's width: pinning a 1fr page column against a fixed rail left the
        two hugging the outer edges with a hole between them, and let the frame
        grow into a tablet on a wide window.
      */}
        <div
          className={`flex flex-col gap-4 ${
            showPublishRail
              ? "lg:grid lg:grid-cols-[minmax(0,420px)_320px] lg:items-start lg:justify-center lg:gap-6 xl:grid-cols-[minmax(0,420px)_340px]"
              : ""
          }`}
        >
          <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-none">
            {/*
            Preview brand entry points: signed-in menus live in a café, so
            the bar shows whenever the editor runs in account mode; a
            browser-only menu has no café to brand. Staff see the header
            without the Change buttons (canManage is false for them).
            */}
            {syncMode === "account" && canManage && restaurantId && onBrandChanged && (
              <PreviewBrandBar restaurantId={restaurantId} onBrandChanged={onBrandChanged} />
            )}
            <PhoneFrame
              label="What a table card opens"
              heightClass={
                showPublishRail
                  ? "h-[min(78vh,860px)] lg:h-[min(84vh,900px)]"
                  : "h-[min(78vh,860px)]"
              }
              // A frame is a phone at every width — never a tablet. The grid
              // track shrinks it on a narrow `lg`, and it never exceeds 420.
              widthClass="max-w-[420px]"
            >
              <OrderPagePreview
                doc={doc}
                restaurantName={restaurantName}
                restaurantLogo={restaurantLogo}
                restaurantCover={restaurantCover}
                draftAheadOfLive={needsPublish}
              />
            </PhoneFrame>
          </div>
          {publishing && canManage && (
            <div className="order-1 flex flex-col gap-3 lg:order-none lg:sticky lg:top-4">
              {/*
              One card at every width — the same states, the same copy. On a
              phone it stacks above the page; from `lg` it is the rail. Only
              the placement changes, never what it says.
            */}
              <PublishPanel
                signedIn={syncMode === "account"}
                controls={publishing}
                draftDoc={doc}
                onStartWizard={onStartPublish}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === "reorder") {
    return (
      <div className="flex flex-col gap-4">
        {tabStrip}
        <div className="rounded-2xl border border-line-200 bg-surface-base p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold text-ink-900">Reorder</h2>
            <p className="text-xs text-ink-500">
              Drag rows by the grip, or nudge with ↑ ↓ — every row keeps its steppers.
              {isFiltering && " Search is paused here; every row is shown."}
            </p>
          </div>
          <div
            role="group"
            aria-label="Reorder scope"
            className="mt-3 inline-flex rounded-full border border-line-300 bg-surface-base p-0.5"
          >
            {(
              [
                { value: "categories", label: "Categories" },
                { value: "items", label: "Items" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={reorderScope === option.value}
                onClick={() => chooseReorder(option.value, activeReorderCategory?.id ?? null)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                  reorderScope === option.value
                    ? "bg-accent-700 text-on-accent"
                    : "text-ink-600 hover:text-ink-900"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {doc.categories.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">
              No categories yet — add one on the edit screen.
            </p>
          ) : reorderScope === "categories" ? (
            <ol className="mt-3 space-y-2">
              {doc.categories.map((category, categoryIndex) => (
                <li
                  key={category.id}
                  draggable
                  onDragStart={(event) => startRowDrag(event, category.id)}
                  onDragOver={(event) => overRow(event, category.id)}
                  onDrop={(event) => dropCategoryRow(event, category.id)}
                  onDragEnd={endRowDrag}
                  className="rounded-xl border border-line-200"
                >
                  {dropLine(category.id, "before")}
                  <div className="flex items-center gap-1.5 px-3 py-2">
                    <span aria-hidden="true" className="shrink-0 cursor-grab text-ink-400">
                      ⋮⋮
                    </span>
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
                  {dropLine(category.id, "after")}
                </li>
              ))}
            </ol>
          ) : activeReorderCategory ? (
            <>
              <div className="mt-3">
                <CategoryPills
                  pills={doc.categories.map((category) => ({
                    id: category.id,
                    name: category.name,
                    dishCount: category.items.length,
                    selected: category.id === activeReorderCategory.id,
                  }))}
                  onSelect={(categoryId) => chooseReorder("items", categoryId)}
                />
              </div>
              {activeReorderCategory.items.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-line-200 px-4 py-3 text-center text-sm text-ink-500">
                  No dishes in {activeReorderCategory.name || "this category"} yet — add one on the
                  Categories tab.
                </p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {activeReorderCategory.items.map((item, index) => {
                    const label = item.name.trim() ? item.name : "Untitled item";
                    return (
                      <li
                        key={item.id}
                        draggable
                        onDragStart={(event) => startRowDrag(event, item.id)}
                        onDragOver={(event) => overRow(event, item.id)}
                        onDrop={(event) => dropItemRow(event, item.id)}
                        onDragEnd={endRowDrag}
                        className="rounded-xl border border-line-200"
                      >
                        {dropLine(item.id, "before")}
                        <div className="flex items-center gap-1.5 px-3 py-1.5">
                          <span aria-hidden="true" className="shrink-0 cursor-grab text-ink-400">
                            ⋮⋮
                          </span>
                          <span
                            aria-hidden="true"
                            className="w-6 shrink-0 text-right text-xs text-ink-500"
                          >
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                            {label}
                          </span>
                          {duplicateIds.has(item.id) && (
                            <span
                              title="This name appears more than once — see the duplicate review on the Categories tab."
                              className="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900"
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
                              onChange(moveItem(doc, activeReorderCategory.id, item.id, index - 1))
                            }
                            aria-label={`Move ${label} up`}
                            className={tinyButton}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={index >= activeReorderCategory.items.length - 1}
                            onClick={() =>
                              onChange(moveItem(doc, activeReorderCategory.id, item.id, index + 1))
                            }
                            aria-label={`Move ${label} down`}
                            className={tinyButton}
                          >
                            ↓
                          </button>
                        </div>
                        {dropLine(item.id, "after")}
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tabStrip}
      {subTab === "categories" ? (
        <>
          <div className="text-xs leading-5 text-ink-600">
            {onStartPublish && accountCheckFailed ? (
              <p>
                We couldn&apos;t check your account just now, so publishing is paused.{" "}
                {onRetryAccountCheck && (
                  <button
                    type="button"
                    onClick={onRetryAccountCheck}
                    className="font-medium text-accent-800 underline underline-offset-2 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
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
                  className="font-medium text-accent-800 underline underline-offset-2 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  set up table ordering
                </button>{" "}
                — we create your café if you don&apos;t have one yet. Or{" "}
                <button
                  type="button"
                  onClick={() => changeMode("preview")}
                  className="font-medium text-accent-800 underline underline-offset-2 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
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
                  className="font-medium text-accent-800 underline underline-offset-2 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  go to Preview
                </button>{" "}
                to publish it for your tables.
              </p>
            )}
          </div>
          <DuplicateReview
            groups={duplicateGroups}
            currency={doc.currency}
            onKeepGroup={dismissGroup}
            onDeleteCopy={(categoryId, item) => void removeItem(categoryId, item)}
          />
          {doc.categories.length > 0 && (
            <CategoryStrip
              tabs={doc.categories.map((category) => ({
                id: category.id,
                name: category.name,
                dishCount: category.items.length,
              }))}
              selectedId={selection.categoryId}
              onSelect={handleCategorySelect}
              query={query}
              onQueryChange={setQuery}
              searchInputRef={searchInputRef}
              onAddCategory={handleAddCategory}
              matchCount={search.matchCount}
              totalItems={search.totalItems}
            />
          )}
          {doc.categories.length === 0 ? (
            // A menu started from scratch has no categories, so the strip above
            // (which carries "+ Category") is not rendered yet: the first
            // category is added here, where the empty canvas is, instead of
            // pointing at a control that isn't on the screen.
            <div className="rounded-2xl border border-dashed border-line-200 bg-surface-base p-8 text-center">
              <p className="font-medium text-ink-900">No categories yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-600">
                A category is the group a menu is read in — “Coffee”, “Mains”, “Desserts”. Add the
                first one, then add dishes to it.
              </p>
              <button
                type="button"
                onClick={handleAddCategory}
                className="mt-4 rounded-full bg-accent-700 px-4 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                + Add category
              </button>
            </div>
          ) : isFiltering ? (
            <div className="flex flex-col gap-2">
              <p role="status" className="text-xs font-medium text-ink-500">
                {search.matchCount} of {search.totalItems}{" "}
                {search.totalItems === 1 ? "item" : "items"}
              </p>
              <SearchResultsList
                rows={flatRows}
                currency={doc.currency}
                onPick={handleResultPick}
              />
            </div>
          ) : selectedCategory ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
              {/* The left column holds the category canvas and, once dishes are
              ticked, the bulk bar. The bar has to be the column's *last* child:
              `sticky bottom-*` only clamps an element whose normal position is
              below the scrollport, so a bar parked above the list scrolls away
              instead of docking. Hiding the column on a phone while the
              inspector is open (the same rule the card itself follows) keeps
              the bar off the inspector's footer. */}
              <div
                className={`${selection.itemId ? "hidden lg:flex" : "flex"} min-w-0 flex-col gap-3`}
              >
                <section
                  data-menu-section={selectedCategory.id}
                  id={`menu-section-${selectedCategory.id}`}
                  aria-label={`Category ${selectedCategory.name}`}
                  className={`${selection.itemId ? "hidden lg:block " : ""}scroll-mt-4 rounded-2xl border border-line-200 bg-surface-base`}
                >
                  {/* One category on the canvas: its band holds the name, the
              count, and the one thing that acts on the category itself.
              Ordering lives in the Reorder tab, so this band carries no
              up/down steppers.

              It is sticky for the same reason the inspector's header is: a
              long category scrolls the section's name away, and the name is
              the one fact the rows under it belong to. The section cannot
              clip its corners (`overflow-hidden` would make it the sticky
              containing block and the band would never leave the card), so
              the band rounds its own top edge instead. */}
                  <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-t-2xl border-b border-line-200 bg-linear-to-b from-accent-100 to-surface-base px-3 py-2">
                    <h2 className="min-w-[9rem] flex-1 truncate px-1 text-base font-semibold text-ink-900">
                      {selectedCategory.name || "Untitled category"}
                    </h2>
                    <p className="shrink-0 text-xs text-ink-500">
                      {selectedCategory.items.length}{" "}
                      {selectedCategory.items.length === 1 ? "item" : "items"}
                      {selectedToCheck > 0 && (
                        <span className="ml-2 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900">
                          {selectedToCheck} to check
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(selectedCategory, selectedCategoryIndex)}
                      className={`${tinyButton} hover:border-danger-700 hover:text-danger-800`}
                    >
                      Delete category
                    </button>
                  </div>
                  <div className="p-4">
                    <CategoryHeader
                      doc={doc}
                      category={selectedCategory}
                      canUpload={canUploadItemImages}
                      onChange={onChange}
                    />
                    {selectedCategory.items.length === 0 ? (
                      <p className="mt-3 rounded-xl border border-dashed border-line-200 bg-surface-base px-4 py-3 text-center text-sm text-ink-500">
                        No items — add the first one below.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {selectedCategory.items.map((item) => (
                          <DishRow
                            key={item.id}
                            item={item}
                            currency={doc.currency}
                            selected={item.id === selection.itemId}
                            bulkSelected={selectedIds.has(item.id)}
                            duplicate={duplicateIds.has(item.id)}
                            actions={rowActions}
                          />
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAddItem(selectedCategory.id)}
                      className={`${smallButton} mt-3`}
                    >
                      + Add item
                    </button>
                  </div>
                </section>
                {selected.length > 0 && (
                  // Docked to the viewport bottom so it never piles up against
                  // the sticky category band at the top — the two Delete
                  // buttons stay far apart. On a phone it floats above the tab
                  // bar (56px buttons plus the safe area); wider screens have
                  // no tab bar.
                  <div
                    role="region"
                    aria-label="Bulk actions"
                    className="sticky bottom-20 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line-200 bg-surface-base p-3 shadow-sm sm:bottom-3"
                  >
                    <p className="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-800">
                      {selected.length} {selected.length === 1 ? "item" : "items"} selected
                    </p>
                    <label className="flex items-center gap-1.5 text-xs text-ink-600">
                      Move to
                      <select
                        aria-label="Category to move selected items to"
                        value={bulkTarget}
                        onChange={(event) => setBulkTarget(event.target.value)}
                        className="rounded-full border border-line-300 bg-surface-base px-2 py-1 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
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
                      className={`${smallButton} hover:border-danger-700 hover:text-danger-800`}
                    >
                      Delete {selected.length} {selected.length === 1 ? "item" : "items"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className={smallButton}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {selectedItem && selectedCategory ? (
                <div className="lg:sticky lg:top-4">
                  <ItemInspector
                    doc={doc}
                    categoryId={selectedCategory.id}
                    categoryName={selectedCategory.name}
                    item={selectedItem}
                    categories={categoryChoices}
                    position={selectedItemIndex + 1}
                    count={selectedCategory.items.length}
                    canUploadImage={canUploadItemImages}
                    onChange={onChange}
                    onAttachImage={(image) =>
                      onChange(setItemImage(doc, selectedCategory.id, selectedItem.id, image))
                    }
                    onDuplicate={() =>
                      onChange(duplicateItem(doc, selectedCategory.id, selectedItem.id))
                    }
                    onDelete={() => void removeItem(selectedCategory.id, selectedItem)}
                    onDone={closeInspector}
                    onNext={nextDish}
                  />
                </div>
              ) : (
                <p className="hidden rounded-2xl border border-dashed border-line-200 bg-surface-base px-4 py-6 text-center text-sm text-ink-500 lg:block">
                  Pick a dish to edit it here.
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : subTab === "settings" ? (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
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
                      <span className="text-ink-500"> · {doc.source.originalFileName}</span>
                    )}
                  </p>
                ))}
              {(imageUrl || canManage) && (
                <div className="mt-3">
                  {imageUrl && (
                    <p className="mb-1 text-xs font-medium text-ink-500">Source image</p>
                  )}
                  <div className="flex items-stretch gap-3">
                    {imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- source image is a local blob object URL, which the optimizer cannot handle
                      <img
                        src={imageUrl}
                        alt="Original uploaded menu"
                        className="max-h-28 w-auto self-center rounded-lg border border-line-200 object-contain"
                      />
                    )}
                    {canManage && (
                      <label
                        className={`flex min-w-36 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line-300 bg-surface-50 px-4 py-2 text-center transition-colors hover:border-accent-700 hover:bg-accent-50 focus-within:border-accent-700 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-700 ${addPages.status === "working" ? "pointer-events-none opacity-60" : ""}`}
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
                <p className="mt-2 text-xs font-medium text-warning-800">
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
          <div className="flex flex-col gap-3 rounded-2xl border border-line-200 bg-surface-base p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
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
              className="self-start rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700 sm:self-auto"
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
              className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900"
            >
              Reading the new pages… keep this tab open. Your edits are safe.
            </p>
          )}
          {addPages.status === "added" && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-xl border border-line-200 bg-surface-base px-4 py-3 text-sm text-ink-700"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success-700"
              />
              <span>
                Added {addPages.items} {addPages.items === 1 ? "item" : "items"} in{" "}
                {addPages.categories} {addPages.categories === 1 ? "category" : "categories"} from
                the new pages. Repeats with the existing menu appear in the duplicate review.
              </span>
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
                This browser has your menu saved. We couldn&apos;t check your account just now, so
                it may also be there — nothing was lost either way.{" "}
                {onRetryAccountCheck && (
                  <button
                    type="button"
                    onClick={onRetryAccountCheck}
                    className="font-medium text-accent-800 underline underline-offset-2 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
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
                  ? "This menu is saved to your account, so signing in on another device shows the same menu. This browser keeps a working copy until you sign out."
                  : syncMode === "account"
                    ? "This menu is saved in this browser only. Add it to your account to use it on other devices, or export a JSON backup."
                    : "This menu is saved in this browser only — it doesn't appear on other devices. Sign in to save it to your account, or export a JSON backup."}
              </p>
            )}
          </div>
        </>
      ) : (
        <ModifiersPanel doc={doc} canManage={canManage} onChange={onChange} />
      )}
      {dialog}
    </div>
  );
}

/** One tab in the editor strip: underline + bold dark text when active, so
 * the underline is never the only signal (§7). */
function EditorTab({
  label,
  selected,
  onSelect,
  badge,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
        selected
          ? "border-accent-700 font-bold text-accent-800"
          : "border-transparent font-medium text-ink-500 hover:border-line-300 hover:text-ink-900"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {badge}
      </span>
    </button>
  );
}

/** The save state at a glance: a quiet dot when saved, a spinner while
 * saving, the failure sentence when it failed. Where the save went stays in
 * the tooltip and with screen readers, so the visible status is one word
 * rather than a paragraph nobody asked to read.
 *
 * It has two homes, never both on screen: the tab row from `sm` up, and the
 * phone's top row below it — the shell hands this same component to
 * `BrandBar`, whose right-hand side was empty. The display mode comes from
 * the caller's `className`, because `hidden` and `flex` cannot both live in
 * the base class and win reliably (see the inspector's controls). */
export function SaveStatus({ state, className = "" }: { state: SaveState; className?: string }) {
  return (
    <span
      role="status"
      title={state.detail}
      className={`min-w-0 items-center gap-1.5 text-xs font-medium ${
        state.kind === "error" ? "text-danger-700" : "text-ink-500"
      } ${className}`}
    >
      {state.kind === "saving" ? (
        <>
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-line-400 border-t-transparent"
          />
          Saving…
        </>
      ) : state.kind === "checking" ? (
        <>
          <span className="sr-only">{state.message}</span>
          <Skeleton className="h-3 w-16" />
        </>
      ) : state.kind === "saved" ? (
        <>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success-700" />
          {state.message}
        </>
      ) : (
        <span className="truncate">{state.message}</span>
      )}
      {state.detail && <span className="sr-only"> — {state.detail}</span>}
    </span>
  );
}

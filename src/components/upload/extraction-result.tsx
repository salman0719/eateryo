"use client";

/**
 * Review summary of an extracted (or demo) menu. Takes the narrow
 * `PreviewMenu` shape for the review list, and an optional canonical
 * `MenuDocument` for the phone-framed first look. The first look is the
 * payoff of the capture flow: the owner sees the order page their diners
 * will use, while every flagged line stays fixable in the Check-this queue
 * beside it (price edits + confirms persist to the draft via callbacks).
 *
 * The preview is a draft, never a publication, and ordering is off — the
 * phone frame's caption and the copy both say so.
 */

import { useRef, useState } from "react";

import { Attention, didClearAll } from "@/components/ui/attention";
import { CommitInput, CommitNumber } from "@/components/menu-editor/fields";
import { OrderPagePreview } from "@/components/order/order-page-preview";
import { PhoneFrame } from "@/components/ui/phone-frame";
import { dedupeDietaryLabels } from "@/features/menu/dietary-labels";
import { hasAnyPrice } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";

export interface PreviewItem {
  name: string;
  price: number | null;
  currency: string | null;
  description: string | null;
  variants: { name: string; price: number | null }[];
  available: boolean | null;
  dietaryLabels: string[];
  reviewNotes: string[];
  /** Owner-confirmed intentionally unpriced — a null price stops flagging. */
  unpricedAccepted?: boolean;
}

export interface PreviewCategory {
  name: string;
  items: PreviewItem[];
}

export interface PreviewMenu {
  title: string | null;
  currency: string | null;
  categories: PreviewCategory[];
}

/** How the owner resolved one flagged item on the result screen. */
export type ReviewResolution = "looks-good" | "leave-unpriced";

export interface ReviewItemLocation {
  categoryIndex: number;
  itemIndex: number;
}

interface ExtractionResultProps {
  data: PreviewMenu;
  source: "ai" | "demo";
  onStartOver: () => void;
  /** Open the result in the editor. Absent until Step 4 wiring provides it. */
  onEdit?: () => void;
  /** Save the draft and open the publish wizard (shown when the draft is safe). */
  onPublish?: () => void;
  /** Resolve one flagged item in place (clears its notes; persists to the draft). */
  onResolveItem?: (loc: ReviewItemLocation, resolution: ReviewResolution) => void;
  /** Fix a flagged item's price in place (null = blank; persists to the draft). */
  onUpdatePrice?: (loc: ReviewItemLocation, price: number | null) => void;
  /** Rename a dish in place (persists to the draft; keeps review notes). */
  onRenameItem?: (loc: ReviewItemLocation, name: string) => void;
  /** Edit a dish's description in place (null = blank; keeps review notes). */
  onUpdateDescription?: (loc: ReviewItemLocation, description: string | null) => void;
  /** Replace a dish's size rows in place (blank prices stay null). Adding
   * the first size clears a misread single price to null with it. */
  onUpdateVariants?: (
    loc: ReviewItemLocation,
    variants: { name: string; price: number | null }[]
  ) => void;
  /** Move a dish to another category in place (lands at the end). */
  onMoveItem?: (loc: ReviewItemLocation, toCategoryIndex: number) => void;
  /** Delete a dish from the draft in place (the shell confirms first). */
  onDeleteItem?: (loc: ReviewItemLocation) => void;
  /** Add a dish the AI missed to a category (lands at the end, unpriced
   * unless the owner prices it in the same form). */
  onAddItem?: (categoryIndex: number, draft: NewDishDraft) => void;
  /** Resolve every flagged item at once — the impatient path. Prices stay
   * as shown; unpriced items ship with honestly null totals. */
  onResolveAll?: () => void;
  /** Flagged count when this extraction landed; drives the "N of M checked"
   * progress. Defaults to the live count (no progress shown). */
  initialReviewCount?: number | null;
  /**
   * Label for the edit action while it is the primary path (before the draft
   * is saved). Once `onPublish` exists, Continue takes the primary slot and
   * the edit action becomes a quiet "Fine-tune in the editor" secondary.
   */
  editLabel?: string;
  /** Rename the draft title inline (persists to the draft). Absent = static title. */
  onRenameTitle?: (title: string) => void;
  /** Shown when the draft already exists in local storage. */
  savedNotice?: string | null;
  /**
   * Signed out: onboarding ends at publishing, and the editor opens only
   * after signing in. The First look then carries the reassurance that the
   * draft is not final — every field stays editable on the account.
   */
  reassureEditable?: boolean;
  /** Canonical document for the phone preview; null hides the first look. */
  previewDoc?: MenuDocument | null;
}

function formatPrice(item: PreviewItem, fallbackCurrency: string | null): string {
  if (item.price === null) return item.variants.length > 0 ? "Per size" : "Price needed";
  const currency = item.currency ?? fallbackCurrency ?? "";
  return `${currency ? `${currency} ` : ""}${item.price.toFixed(2)}`;
}

/** An exception, not everything: unpriced (unless accepted) or carrying an
 * extraction note. Uses the canonical `hasAnyPrice` rule from menu-utils, so a
 * size-priced item (null root price, priced variants) counts as priced —
 * this PreviewMenu twin exists only because the result screen renders before
 * the canonical doc is the source. */
function isFlagged(item: PreviewItem): boolean {
  if (item.reviewNotes.length > 0) return true;
  if (!hasAnyPrice(item) && !item.unpricedAccepted) return true;
  return false;
}

/** Inline price fix for the Check-this queue: blank = unknown, never 0.
 * Commits valid entries (empty or a non-negative number); anything else
 * reverts. Controlled with a sync effect so a parent save refreshes it. */
function ReviewPriceInput({
  value,
  currency,
  itemName,
  onCommit,
}: {
  value: number | null;
  currency: string | null;
  itemName: string;
  onCommit: (price: number | null) => void;
}) {
  // Uncontrolled + keyed by the committed value: a parent save remounts the
  // field with the fresh default, so no effect-sync is needed.
  const fallback = value === null ? "" : String(value);
  function commit(event: React.FocusEvent<HTMLInputElement>) {
    const trimmed = event.target.value.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      else event.target.value = "";
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      event.target.value = fallback;
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      {currency && <span className="text-xs text-ink-500">{currency}</span>}
      <input
        key={fallback}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={`Price for ${itemName} — blank if unknown`}
        placeholder="Blank if unknown"
        defaultValue={fallback}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            (event.target as HTMLInputElement).value = fallback;
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="w-28 rounded-lg border border-warning-600 bg-surface-base px-2 py-1 text-sm font-semibold text-ink-900 tabular-nums placeholder:font-normal placeholder:text-ink-500 focus:border-accent-700 focus:outline-none"
      />
    </label>
  );
}

/**
 * Variant A fix card: the row's own fix-it-here form, so a wrong name or
 * description is fixed where it is seen instead of in the editor. Every
 * field persists to the draft through its callback; fixes never clear the
 * check — the notes may concern another field, so confirming stays a
 * separate explicit tap. Exported for tests (which render it directly:
 * expansion itself is client state).
 */
export function ReviewFixCard({
  item,
  loc,
  onRenameItem,
  onUpdateDescription,
  onUpdateVariants,
  categoryNames,
  currentCategoryIndex,
  onMoveItem,
}: {
  item: PreviewItem;
  loc: ReviewItemLocation;
  onRenameItem: (loc: ReviewItemLocation, name: string) => void;
  onUpdateDescription?: (loc: ReviewItemLocation, description: string | null) => void;
  onUpdateVariants?: (
    loc: ReviewItemLocation,
    variants: { name: string; price: number | null }[]
  ) => void;
  /** Category names in document order; the move list excludes the current. */
  categoryNames?: string[];
  currentCategoryIndex?: number;
  onMoveItem?: (loc: ReviewItemLocation, toCategoryIndex: number) => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-line-200 bg-surface-50 p-3">
      <CommitInput
        label="Dish name"
        value={item.name}
        onCommit={(name) => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== item.name) onRenameItem(loc, trimmed);
        }}
      />
      {onUpdateDescription !== undefined && (
        <div className="mt-2">
          <CommitInput
            label="Description"
            value={item.description ?? ""}
            validate={() => null}
            placeholder="Blank if none shown"
            multiline
            onCommit={(description) => {
              const trimmed = description.trim();
              const next = trimmed ? trimmed : null;
              if (next !== item.description) onUpdateDescription(loc, next);
            }}
          />
        </div>
      )}
      {onUpdateVariants !== undefined && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-medium text-ink-500">Sizes</p>
          {item.variants.length === 0 ? (
            <p className="text-xs text-ink-500">None — add one if the menu shows sizes.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {item.variants.map((variant, variantIndex) => (
                <li
                  key={`${variant.name}-${variantIndex}`}
                  className="grid grid-cols-[minmax(0,1fr)_104px_auto] items-end gap-2"
                >
                  <CommitInput
                    label={variantIndex === 0 ? "Size" : `Size ${variantIndex + 1}`}
                    value={variant.name}
                    onCommit={(name) => {
                      const trimmed = name.trim();
                      if (!trimmed || trimmed === variant.name) return;
                      onUpdateVariants(
                        loc,
                        item.variants.map((entry, index) =>
                          index === variantIndex ? { ...entry, name: trimmed } : entry
                        )
                      );
                    }}
                  />
                  <CommitNumber
                    label="Price"
                    value={variant.price}
                    onCommit={(price) => {
                      if (price === variant.price) return;
                      onUpdateVariants(
                        loc,
                        item.variants.map((entry, index) =>
                          index === variantIndex ? { ...entry, price } : entry
                        )
                      );
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove size ${variant.name}`}
                    onClick={() =>
                      onUpdateVariants(
                        loc,
                        item.variants.filter((_, index) => index !== variantIndex)
                      )
                    }
                    className="mb-0.5 rounded-full border border-line-300 px-2 py-1 text-xs text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() =>
              onUpdateVariants(loc, [...item.variants, { name: "New size", price: null }])
            }
            className="mt-2 rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            + Add size
          </button>
        </div>
      )}
      {onMoveItem !== undefined &&
        categoryNames !== undefined &&
        currentCategoryIndex !== undefined &&
        categoryNames.length > 1 && (
          <label className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
            Move to
            <select
              aria-label={`Move ${item.name} to another category`}
              defaultValue=""
              onChange={(event) => {
                const target = Number(event.target.value);
                event.target.value = "";
                if (Number.isInteger(target)) onMoveItem(loc, target);
              }}
              className="rounded-full border border-line-300 bg-surface-base px-2 py-1 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
            >
              <option value="">Category…</option>
              {categoryNames.map((name, index) =>
                index === currentCategoryIndex ? null : (
                  <option key={`${name}-${index}`} value={index}>
                    {name}
                  </option>
                )
              )}
            </select>
          </label>
        )}
      <p className="mt-1 text-[11px] text-ink-500">
        Fixes keep the check — confirm separately once it reads right. Photos, add-ons and labels
        stay in the editor.
      </p>
    </div>
  );
}

/** Fields the owner fills in when adding a dish the AI missed — the same
 * fix-it-here shape as the row card (name, description, price or sizes),
 * so a missed line is fixed with the same interface, not a name-only box. */
export interface NewDishDraft {
  name: string;
  description: string | null;
  price: number | null;
  variants: { name: string; price: number | null }[];
}

/**
 * The "the AI missed a line" path: one toggle per category card holding the
 * same fix-it-here form as a row card. The dish lands at the end of the
 * category — unpriced unless the owner prices it here — so it shows up in
 * Check this honestly instead of sneaking into Ready.
 */
export function AddDishRow({
  onAdd,
  currency,
}: {
  onAdd: (draft: NewDishDraft) => void;
  currency?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [variants, setVariants] = useState<{ name: string; price: number | null }[]>([]);
  function reset() {
    setName("");
    setDescription("");
    setPrice(null);
    setVariants([]);
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-full border border-dashed border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        + Add a dish the AI missed
      </button>
    );
  }
  const canSave = name.trim() !== "";
  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const trimmedDescription = description.trim();
    onAdd({
      name: trimmed,
      description: trimmedDescription ? trimmedDescription : null,
      // Per-size pricing carries a null root by design (same rule as the
      // row card) — the sizes are the prices.
      price: variants.length > 0 ? null : price,
      variants: variants
        .map((variant) => ({ name: variant.name.trim(), price: variant.price }))
        .filter((variant) => variant.name !== ""),
    });
    reset();
    setOpen(false);
  }
  return (
    <div className="mt-2 rounded-xl border border-line-200 bg-surface-50 p-3">
      <CommitInput
        label="Dish name as shown"
        value={name}
        placeholder="e.g. Garlic Bread"
        onCommit={(next) => setName(next.trim())}
      />
      <div className="mt-2">
        <CommitInput
          label="Description"
          value={description}
          validate={() => null}
          placeholder="Blank if none shown"
          multiline
          onCommit={(next) => setDescription(next.trim())}
        />
      </div>
      {variants.length === 0 ? (
        <div className="mt-2">
          <CommitNumber
            label={currency ? `Price (${currency})` : "Price"}
            value={price}
            placeholder="Blank if unknown"
            onCommit={setPrice}
          />
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-500">Priced per size — the dish price stays blank.</p>
      )}
      <div className="mt-2">
        <p className="mb-1 text-xs font-medium text-ink-500">Sizes</p>
        {variants.length === 0 ? (
          <p className="text-xs text-ink-500">None — add one if the menu shows sizes.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {variants.map((variant, variantIndex) => (
              <li
                key={`${variant.name}-${variantIndex}`}
                className="grid grid-cols-[minmax(0,1fr)_104px_auto] items-end gap-2"
              >
                <CommitInput
                  label={variantIndex === 0 ? "Size" : `Size ${variantIndex + 1}`}
                  value={variant.name}
                  onCommit={(next) => {
                    const trimmed = next.trim();
                    if (!trimmed || trimmed === variant.name) return;
                    setVariants((current) =>
                      current.map((entry, index) =>
                        index === variantIndex ? { ...entry, name: trimmed } : entry
                      )
                    );
                  }}
                />
                <CommitNumber
                  label="Price"
                  value={variant.price}
                  onCommit={(nextPrice) => {
                    if (nextPrice === variant.price) return;
                    setVariants((current) =>
                      current.map((entry, index) =>
                        index === variantIndex ? { ...entry, price: nextPrice } : entry
                      )
                    );
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove size ${variant.name}`}
                  onClick={() =>
                    setVariants((current) => current.filter((_, index) => index !== variantIndex))
                  }
                  className="mb-0.5 rounded-full border border-line-300 px-2 py-1 text-xs text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setVariants((current) => [...current, { name: "New size", price: null }])}
          className="mt-2 rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          + Add size
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={submit}
          className="rounded-full bg-accent-700 px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          Add dish
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-full border border-line-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-500">
        Lands in Check this — confirm once it reads right.
      </p>
    </div>
  );
}

export function ExtractionResult({
  data,
  source,
  onStartOver,
  onEdit,
  onPublish,
  onResolveItem,
  onResolveAll,
  onUpdatePrice,
  onRenameItem,
  onUpdateDescription,
  onUpdateVariants,
  onMoveItem,
  onDeleteItem,
  onAddItem,
  onRenameTitle,
  initialReviewCount = null,
  editLabel = "Edit menu",
  savedNotice = null,
  previewDoc = null,
  reassureEditable = false,
}: ExtractionResultProps) {
  const itemCount = data.categories.reduce((sum, c) => sum + c.items.length, 0);
  const reviewCount = data.categories.reduce((sum, c) => sum + c.items.filter(isFlagged).length, 0);
  // Q6 calm review: Ready items are the quiet majority, Check-this the
  // visible work. Both derive from the same flags the editor uses.
  const [showAllReady, setShowAllReady] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  /** One expanded inline fix card at a time, keyed by index path. */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Index paths survive filtering: resolving item (2, 5) must hit the same
  // item in the draft the publish wizard will save.
  const flaggedGroups = data.categories
    .map((category, categoryIndex) => ({
      name: category.name,
      categoryIndex,
      entries: category.items
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item }) => isFlagged(item)),
    }))
    .filter((group) => group.entries.length > 0);
  const peak = Math.max(initialReviewCount ?? reviewCount, reviewCount);
  const checkedCount = peak - reviewCount;
  // The Continue button is two beats of one road: while flags remain it
  // lands in the Check-this queue below (the price-review step); once the
  // queue is clear it becomes the link step. The copy always names the
  // screen the tap actually opens.
  const checkThisRef = useRef<HTMLDivElement | null>(null);
  // When the last flag clears, take the owner back to the Continue box at
  // the top and pulse the freshly-unlocked "Publish" button. Derived
  // from the extraction-time count: only a had-work → none transition fires,
  // so a clean extraction (0 → 0) never yanks the scroll.
  const allClear = didClearAll(initialReviewCount ?? reviewCount, reviewCount);
  // The link step pulses whenever there is nothing left to check — after the
  // last resolve and on a clean extraction alike. The scroll above fires only
  // on the transition, so a clean draft never yanks the page.
  const linkReady = reviewCount === 0;
  function handleContinue() {
    if (reviewCount > 0) {
      // Jump to the queue without collapsing the Ready list above it: hiding
      // it yanks the page and the scroll target out from under the owner.
      // The "Show only items to check" toggle stays a manual choice.
      checkThisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    onPublish?.();
  }
  // Ready rows carry their index paths too: a confident read can still be
  // wrong, so every row — flagged or not — opens the same fix card.
  const readyEntries = data.categories.flatMap((category, categoryIndex) =>
    category.items
      .map((item, itemIndex) => ({ item, loc: { categoryIndex, itemIndex } }))
      .filter(({ item }) => !isFlagged(item))
  );
  const visibleReadyEntries = showAllReady ? readyEntries : readyEntries.slice(0, 5);

  // Q7: exactly one primary road. Continue takes the primary slot as soon as
  // the draft is safe; the editor stays as a quiet secondary, never a
  // competing equal. The old amber publish card is gone on purpose — two
  // identical CTAs were the confusion.

  /** The row's own fix-it-here form with every field the review owns.
   * Moving re-keys every index path, so it closes the card: its locator
   * would point at a different dish. Deleting lives on the row itself. */
  function fixCard(loc: ReviewItemLocation, item: PreviewItem) {
    if (onRenameItem === undefined) return null;
    return (
      <ReviewFixCard
        item={item}
        loc={loc}
        onRenameItem={onRenameItem}
        onUpdateDescription={onUpdateDescription}
        onUpdateVariants={onUpdateVariants}
        categoryNames={data.categories.map((category) => category.name)}
        currentCategoryIndex={loc.categoryIndex}
        onMoveItem={
          onMoveItem !== undefined
            ? (moveLoc, toCategoryIndex) => {
                setExpandedKey(null);
                onMoveItem(moveLoc, toCategoryIndex);
              }
            : undefined
        }
      />
    );
  }

  /** One category card with full detail rows (badges + notes + resolve actions).
   * `locator` maps a rendered row back to its index path in `data`, so a
   * confirm hits the same item in the draft the wizard will save. */
  function renderCategoryCard(
    categoryName: string,
    categoryIndex: number,
    items: PreviewItem[],
    locator?: (itemIndex: number) => ReviewItemLocation | null
  ) {
    return (
      <div
        key={categoryName}
        className="overflow-hidden rounded-2xl border border-line-200 bg-surface-base"
      >
        <h3 className="border-b border-line-100 bg-surface-50 px-5 py-3 text-sm font-bold tracking-wide text-ink-800 uppercase">
          {categoryName}
        </h3>
        <ul className="divide-y divide-line-100">
          {items.map((item, rowIndex) => {
            const needsReview = isFlagged(item);
            const loc = locator?.(rowIndex) ?? null;
            const canResolve = needsReview && loc !== null && onResolveItem !== undefined;
            // Variant A: the fix-it-here card lives on the row itself, so a
            // wrong name is fixed where it is seen instead of in the editor.
            // Renaming never clears the check — the notes may concern the
            // price, so confirming stays a separate explicit tap.
            const canFixName = loc !== null && onRenameItem !== undefined;
            // The shell confirms before this fires; deleting re-keys every
            // index path, so it closes the card like moving does.
            const canDelete = loc !== null && onDeleteItem !== undefined;
            const expandKey =
              loc !== null ? `${loc.categoryIndex}-${loc.itemIndex}` : `row-${rowIndex}`;
            const expanded = expandedKey === expandKey;
            // The Check-this queue is the price-review step: flagged rows get
            // a fix-it-here price field. The whole-list views stay read-only,
            // and a size-priced item keeps its prices in its variants — its
            // root price stays blank, so it never gets a root-price field.
            const canEditPrice =
              needsReview && loc !== null && onUpdatePrice !== undefined && !hasAnyPrice(item);
            return (
              <li key={`${categoryName}-${item.name}-${rowIndex}`} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink-900">
                    <span>{item.name}</span>
                    {item.available === false && (
                      <span className="shrink-0 rounded-full bg-surface-200 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                        Unavailable
                      </span>
                    )}
                    {needsReview && (
                      <span className="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900">
                        {hasAnyPrice(item) ? "Couldn't read" : "Check price"}
                      </span>
                    )}
                  </p>
                  {canEditPrice ? (
                    <ReviewPriceInput
                      value={item.price}
                      currency={item.currency ?? data.currency}
                      itemName={item.name}
                      onCommit={(price) => onUpdatePrice?.(loc, price)}
                    />
                  ) : (
                    <p
                      className={
                        item.price === null
                          ? "shrink-0 text-sm font-semibold text-warning-800"
                          : "shrink-0 text-sm font-semibold text-ink-900"
                      }
                    >
                      {formatPrice(item, data.currency)}
                    </p>
                  )}
                </div>
                {item.description && (
                  <p className="mt-0.5 text-sm text-ink-600">{item.description}</p>
                )}
                {item.variants.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                    {item.variants.map((variant, index) => (
                      <li key={`${variant.name}-${index}`} className="tabular-nums">
                        {variant.name}
                        <span className="ml-1.5 font-medium text-ink-800">
                          {variant.price === null
                            ? "—"
                            : `${item.currency ?? data.currency ?? ""}${item.currency || data.currency ? " " : ""}${variant.price.toFixed(2)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {dedupeDietaryLabels(item.dietaryLabels).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {dedupeDietaryLabels(item.dietaryLabels).map((label) => (
                      <span
                        key={label}
                        className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-ink-700"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                {item.reviewNotes.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-warning-800">
                    {item.reviewNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                {(canFixName || canResolve || canDelete) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canFixName && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedKey(expanded ? null : expandKey)}
                        className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                      >
                        {expanded ? "Close" : needsReview ? "Fix…" : "Edit…"}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => {
                          setExpandedKey(null);
                          if (loc !== null) onDeleteItem?.(loc);
                        }}
                        title="Removes the dish from the draft — a published revision may still show it until you republish."
                        className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                      >
                        Delete
                      </button>
                    )}
                    {canResolve &&
                      (hasAnyPrice(item) ? (
                        <button
                          type="button"
                          onClick={() => onResolveItem?.(loc, "looks-good")}
                          className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                        >
                          ✓ Looks good
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onResolveItem?.(loc, "leave-unpriced")}
                          title="Keeps the price blank — totals stay honestly blank for this item."
                          className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                        >
                          ✓ Leave unpriced
                        </button>
                      ))}
                  </div>
                )}
                {expanded && loc !== null && fixCard(loc, item)}
              </li>
            );
          })}
        </ul>
        {onAddItem !== undefined && (
          <div className="border-t border-line-100 px-5 py-3">
            <AddDishRow
              currency={data.currency}
              onAdd={(draft) => onAddItem(categoryIndex, draft)}
            />
          </div>
        )}
      </div>
    );
  }

  // Q6 calm review: Ready is the quiet majority (names + prices, no badges),
  // Check-this the visible work. With nothing flagged the list renders whole,
  // exactly as before.
  const draftDetails =
    data.categories.length === 0 ? (
      <div className="rounded-2xl border border-line-200 bg-surface-base p-8 text-center">
        <p className="font-medium text-ink-900">No menu content detected</p>
        <p className="mt-1 text-sm text-ink-600">
          The image may not show a menu, or the text was unreadable. Try a clearer photo.
        </p>
      </div>
    ) : reviewCount === 0 ? (
      <div className="flex flex-col gap-3">
        {/* A clean extraction still gets fix cards: confidence is not trust. */}
        {data.categories.map((category, categoryIndex) =>
          renderCategoryCard(category.name, categoryIndex, category.items, (rowIndex) => ({
            categoryIndex,
            itemIndex: rowIndex,
          }))
        )}
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {!onlyFlagged && (
          <section
            aria-label="Ready items"
            className="rounded-2xl border border-line-200 bg-surface-base p-5"
          >
            <h3 className="text-sm font-semibold text-ink-900">✓ Ready ({readyEntries.length})</h3>
            {readyEntries.length === 0 ? (
              <p className="mt-1 text-sm text-ink-600">Every item needs a look — start below.</p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-line-100">
                  {visibleReadyEntries.map(({ item, loc: readyLoc }) => {
                    const readyKey = `ready-${readyLoc.categoryIndex}-${readyLoc.itemIndex}`;
                    const readyExpanded = expandedKey === readyKey;
                    return (
                      <li key={readyKey} className="py-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          {/* Wraps instead of truncating: a long dish name is the
                              thing being checked, so it must be readable whole. */}
                          <span className="min-w-0 flex-1 break-words text-sm text-ink-800">
                            {item.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-sm font-medium text-ink-800 tabular-nums">
                              {formatPrice(item, data.currency)}
                            </span>
                            {onRenameItem !== undefined && (
                              <button
                                type="button"
                                aria-expanded={readyExpanded}
                                onClick={() => setExpandedKey(readyExpanded ? null : readyKey)}
                                className="rounded-full border border-line-300 px-2 py-0.5 text-[11px] font-medium text-ink-500 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                              >
                                {readyExpanded ? "Close" : "Edit…"}
                              </button>
                            )}
                            {onDeleteItem !== undefined && (
                              <button
                                type="button"
                                aria-label={`Delete ${item.name}`}
                                onClick={() => {
                                  setExpandedKey(null);
                                  onDeleteItem(readyLoc);
                                }}
                                title="Removes the dish from the draft — a published revision may still show it until you republish."
                                className="rounded-full border border-line-300 px-2 py-0.5 text-[11px] font-medium text-ink-500 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                              >
                                Delete
                              </button>
                            )}
                          </span>
                        </div>
                        {readyExpanded && fixCard(readyLoc, item)}
                      </li>
                    );
                  })}
                </ul>
                {readyEntries.length > visibleReadyEntries.length ? (
                  <button
                    type="button"
                    onClick={() => setShowAllReady(true)}
                    className="mt-2 text-xs font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                  >
                    …and {readyEntries.length - visibleReadyEntries.length} more — no action needed
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-ink-500">
                    {onRenameItem !== undefined
                      ? "No badges, no action needed — Edit… still opens any row."
                      : "No badges, no action needed."}
                  </p>
                )}
              </>
            )}
          </section>
        )}
        <div
          ref={checkThisRef}
          className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-background/95 py-2 scroll-mt-4"
        >
          <h3 className="text-xs font-semibold tracking-[0.18em] text-warning-800 uppercase">
            ⚠ Check this ({reviewCount})
          </h3>
          <div className="flex items-center gap-3">
            {checkedCount > 0 && (
              <span className="text-xs font-medium text-success-800">
                ✓ {checkedCount} of {peak} checked
              </span>
            )}
            {onResolveAll && (
              <button
                type="button"
                onClick={onResolveAll}
                title="Confirms every flagged item as shown — prices stay as they are, unpriced items keep honestly blank totals."
                className="rounded-full border border-warning-300 bg-warning-50 px-3 py-1 text-xs font-semibold text-accent-900 transition-colors hover:border-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Accept all as shown
              </button>
            )}
          </div>
        </div>
        {flaggedGroups.map((group) =>
          renderCategoryCard(
            group.name,
            group.categoryIndex,
            group.entries.map(({ item }) => item),
            (rowIndex) => ({
              categoryIndex: group.categoryIndex,
              itemIndex: group.entries[rowIndex].itemIndex,
            })
          )
        )}
      </div>
    );

  return (
    <section aria-label="Extraction result" className="flex flex-col gap-4">
      <Attention
        active={allClear}
        pulse={false}
        scrollBlock="start"
        className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line-200 bg-surface-base p-5 scroll-mt-4"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {onRenameTitle ? (
              <div className="min-w-52 flex-1">
                <CommitInput
                  label="Menu title"
                  value={data.title ?? ""}
                  placeholder="e.g. Main Menu"
                  onCommit={(title) => {
                    if (title.trim()) onRenameTitle(title.trim());
                  }}
                  inputClassName="text-xl font-bold"
                />
                <p className="mt-0.5 text-xs text-ink-500">
                  Guests see this at the top — fix it if the photo missed it.
                </p>
              </div>
            ) : (
              <h2 className="text-xl font-bold text-ink-900">{data.title ?? "Untitled menu"}</h2>
            )}
            {source === "ai" ? (
              <span className="rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-semibold text-warning-900">
                {reviewCount > 0 ? `AI draft — ${reviewCount} to check` : "AI draft"}
              </span>
            ) : (
              <span className="rounded-full bg-info-100 px-2.5 py-0.5 text-xs font-semibold text-info-900">
                Demo data
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-600">
            {data.categories.length} {data.categories.length === 1 ? "category" : "categories"} ·{" "}
            {itemCount} {itemCount === 1 ? "item" : "items"}
            {reviewCount > 0 && (
              <span className="font-medium text-warning-800"> · {reviewCount} to check</span>
            )}
          </p>
          {source === "ai" && (
            <p className="mt-1 text-xs text-ink-500">
              Prices and names are a best-effort draft. Check anything marked before using it.
            </p>
          )}
          {savedNotice && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-100 px-2.5 py-0.5 text-xs font-semibold text-ink-900">
              <span aria-hidden="true" className="text-success-700">
                ✓
              </span>
              {savedNotice}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onPublish && (
            <Attention
              active={linkReady}
              scroll={false}
              inline
              className="inline-flex rounded-full"
            >
              <button
                type="button"
                onClick={handleContinue}
                className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                {reviewCount > 0 ? `Continue → check prices (${reviewCount})` : "Publish →"}
              </button>
            </Attention>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className={
                onPublish
                  ? "rounded-full px-4 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                  : "rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              }
            >
              {onPublish ? "Fine-tune in the editor" : editLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onStartOver}
            className="rounded-full border border-line-300 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Start over
          </button>
        </div>
      </Attention>

      {/* The preview is the draft's own page, so it gets room to read as one:
          400px, the editor's width, instead of a form-sized 320. */}
      {previewDoc ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <aside className="flex flex-col gap-2 lg:sticky lg:top-4">
            <PhoneFrame label="What a table card opens" widthClass="max-w-[400px]">
              <OrderPagePreview doc={previewDoc} />
            </PhoneFrame>
          </aside>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-warning-800 uppercase">
                First look
              </p>
              <h3 className="mt-1 text-lg font-bold text-ink-900">
                This is what diners will order from
              </h3>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                Nothing is live yet, and ordering is off in this preview. Check anything marked,
                then publish it when it looks right.
              </p>
              {reassureEditable && (
                <p className="mt-2 text-sm leading-6 text-ink-800">
                  <strong className="font-semibold text-ink-900">
                    Don&apos;t worry about getting everything right
                  </strong>{" "}
                  — you can always make changes in the editor once you sign in.
                </p>
              )}
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold tracking-[0.18em] text-ink-500 uppercase">
                {onlyFlagged ? "Items to check" : "Full draft"}
              </h3>
              <div className="flex items-baseline gap-3">
                {reviewCount > 0 && (
                  <span className="text-xs text-warning-800">{reviewCount} to check</span>
                )}
                {reviewCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyFlagged((value) => !value)}
                    aria-pressed={onlyFlagged}
                    className="text-xs font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                  >
                    {onlyFlagged ? "Show everything" : "Show only items to check"}
                  </button>
                )}
              </div>
            </div>

            {draftDetails}
          </div>
        </div>
      ) : (
        draftDetails
      )}
    </section>
  );
}

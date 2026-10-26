"use client";

/**
 * Review summary of an extracted (or demo) menu. Takes the narrow
 * `PreviewMenu` shape for the review list, and an optional canonical
 * `MenuDocument` for the phone-framed first look. The first look is the
 * payoff of the capture flow: the owner sees their menu the way a guest
 * will, while every flagged line stays fixable in the Check-this queue
 * beside it (price edits + confirms persist to the draft via callbacks).
 *
 * The preview is a draft, never a publication — the phone frame's caption
 * and the copy both say so.
 */

import { useRef, useState } from "react";

import { Attention, didClearAll } from "@/components/ui/attention";
import { MenuPreview } from "@/components/menu-editor/menu-preview";
import { PhoneFrame } from "@/components/ui/phone-frame";
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
  /** Shown when the draft already exists in local storage. */
  savedNotice?: string | null;
  /** Canonical document for the phone preview; null hides the first look. */
  previewDoc?: MenuDocument | null;
}

function formatPrice(item: PreviewItem, fallbackCurrency: string | null): string {
  if (item.price === null) return item.variants.length > 0 ? "Per size" : "Price needed";
  const currency = item.currency ?? fallbackCurrency ?? "";
  return `${currency ? `${currency} ` : ""}${item.price.toFixed(2)}`;
}

/** An exception, not everything: unpriced (unless accepted) or carrying an
 * extraction note. Mirrors `isItemFlagged` in menu-utils, which owns the
 * canonical MenuDocument definition — this PreviewMenu twin exists because
 * the result screen renders before the canonical doc is the source. */
function isFlagged(item: PreviewItem): boolean {
  if (item.reviewNotes.length > 0) return true;
  if (item.price === null && !item.unpricedAccepted) return true;
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
      {currency && <span className="text-xs text-stone-500">{currency}</span>}
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
        className="w-28 rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm font-semibold text-stone-900 tabular-nums placeholder:font-normal placeholder:text-stone-400 focus:border-amber-700 focus:outline-none"
      />
    </label>
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
  initialReviewCount = null,
  editLabel = "Edit menu",
  savedNotice = null,
  previewDoc = null,
}: ExtractionResultProps) {
  const itemCount = data.categories.reduce((sum, c) => sum + c.items.length, 0);
  const reviewCount = data.categories.reduce((sum, c) => sum + c.items.filter(isFlagged).length, 0);
  // Q6 calm review: Ready items are the quiet majority, Check-this the
  // visible work. Both derive from the same flags the editor uses.
  const [showAllReady, setShowAllReady] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
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
  // the top and pulse the freshly-unlocked "Get your link" button. Derived
  // from the extraction-time count: only a had-work → none transition fires,
  // so a clean extraction (0 → 0) never yanks the scroll.
  const allClear = didClearAll(initialReviewCount ?? reviewCount, reviewCount);
  // The link step pulses whenever there is nothing left to check — after the
  // last resolve and on a clean extraction alike. The scroll above fires only
  // on the transition, so a clean draft never yanks the page.
  const linkReady = reviewCount === 0;
  function handleContinue() {
    if (reviewCount > 0) {
      setOnlyFlagged(true);
      checkThisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    onPublish?.();
  }
  const readyItems = data.categories.flatMap((category) =>
    category.items.filter((item) => !isFlagged(item))
  );
  const visibleReady = showAllReady ? readyItems : readyItems.slice(0, 5);

  // Q7: exactly one primary road. Continue takes the primary slot as soon as
  // the draft is safe; the editor stays as a quiet secondary, never a
  // competing equal. The old amber publish card is gone on purpose — two
  // identical CTAs were the confusion.

  /** One category card with full detail rows (badges + notes + resolve actions).
   * `locator` maps a rendered row back to its index path in `data`, so a
   * confirm hits the same item in the draft the wizard will save. */
  function renderCategoryCard(
    categoryName: string,
    items: PreviewItem[],
    locator?: (itemIndex: number) => ReviewItemLocation | null
  ) {
    return (
      <div
        key={categoryName}
        className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
      >
        <h3 className="border-b border-stone-100 bg-stone-50 px-5 py-3 text-sm font-bold tracking-wide text-stone-800 uppercase">
          {categoryName}
        </h3>
        <ul className="divide-y divide-stone-100">
          {items.map((item, rowIndex) => {
            const needsReview = isFlagged(item);
            const loc = locator?.(rowIndex) ?? null;
            const canResolve = needsReview && loc !== null && onResolveItem !== undefined;
            // The Check-this queue is the price-review step: flagged rows get
            // a fix-it-here price field. The whole-list views stay read-only.
            const canEditPrice = needsReview && loc !== null && onUpdatePrice !== undefined;
            return (
              <li key={`${categoryName}-${item.name}-${rowIndex}`} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex items-center gap-2 font-medium text-stone-900">
                    <span>{item.name}</span>
                    {item.available === false && (
                      <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                        Unavailable
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
                          ? "shrink-0 text-sm font-semibold text-amber-800"
                          : "shrink-0 text-sm font-semibold text-stone-900"
                      }
                    >
                      {formatPrice(item, data.currency)}
                    </p>
                  )}
                </div>
                {item.description && (
                  <p className="mt-0.5 text-sm text-stone-600">{item.description}</p>
                )}
                {item.variants.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
                    {item.variants.map((variant, index) => (
                      <li key={`${variant.name}-${index}`} className="tabular-nums">
                        {variant.name}
                        <span className="ml-1.5 font-medium text-stone-800">
                          {variant.price === null
                            ? "—"
                            : `${item.currency ?? data.currency ?? ""}${item.currency || data.currency ? " " : ""}${variant.price.toFixed(2)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.dietaryLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-900"
                    >
                      {label}
                    </span>
                  ))}
                  {needsReview && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                      {item.price === null ? "Check price" : "Couldn't read"}
                    </span>
                  )}
                </div>
                {item.reviewNotes.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                    {item.reviewNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                {canResolve && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.price !== null ? (
                      <button
                        type="button"
                        onClick={() => onResolveItem?.(loc, "looks-good")}
                        className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-green-700 hover:text-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
                      >
                        ✓ Looks good
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onResolveItem?.(loc, "leave-unpriced")}
                        title="Keeps the price blank — totals stay honestly blank for this item."
                        className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-green-700 hover:text-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
                      >
                        ✓ Leave unpriced
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Q6 calm review: Ready is the quiet majority (names + prices, no badges),
  // Check-this the visible work. With nothing flagged the list renders whole,
  // exactly as before.
  const draftDetails =
    data.categories.length === 0 ? (
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <p className="font-medium text-stone-900">No menu content detected</p>
        <p className="mt-1 text-sm text-stone-600">
          The image may not show a menu, or the text was unreadable. Try a clearer photo.
        </p>
      </div>
    ) : reviewCount === 0 ? (
      <div className="flex flex-col gap-3">
        {data.categories.map((category) => renderCategoryCard(category.name, category.items))}
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {!onlyFlagged && (
          <section aria-label="Ready items" className="rounded-2xl border border-stone-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-stone-900">
              ✓ Ready ({readyItems.length})
            </h3>
            {readyItems.length === 0 ? (
              <p className="mt-1 text-sm text-stone-600">
                Every item needs a look — start below.
              </p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-stone-100">
                  {visibleReady.map((item) => (
                    <li
                      key={`ready-${item.name}`}
                      className="flex items-baseline justify-between gap-3 py-1.5"
                    >
                      <span className="min-w-0 truncate text-sm text-stone-800">{item.name}</span>
                      <span className="shrink-0 text-sm font-medium text-stone-800 tabular-nums">
                        {formatPrice(item, data.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                {readyItems.length > visibleReady.length ? (
                  <button
                    type="button"
                    onClick={() => setShowAllReady(true)}
                    className="mt-2 text-xs font-medium text-stone-500 underline underline-offset-2 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                  >
                    …and {readyItems.length - visibleReady.length} more — no action needed
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">No badges, no action needed.</p>
                )}
              </>
            )}
          </section>
        )}
        <div ref={checkThisRef} className="flex flex-wrap items-center justify-between gap-2 scroll-mt-4">
          <h3 className="text-xs font-semibold tracking-[0.18em] text-amber-800 uppercase">
            ⚠ Check this ({reviewCount})
          </h3>
          <div className="flex items-center gap-3">
            {checkedCount > 0 && (
              <span className="text-xs font-medium text-green-800">
                ✓ {checkedCount} of {peak} checked
              </span>
            )}
            {onResolveAll && (
              <button
                type="button"
                onClick={onResolveAll}
                title="Confirms every flagged item as shown — prices stay as they are, unpriced items keep honestly blank totals."
                className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 transition-colors hover:border-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                Accept all as shown
              </button>
            )}
          </div>
        </div>
        {flaggedGroups.map((group) =>
          renderCategoryCard(group.name, group.entries.map(({ item }) => item), (rowIndex) => ({
            categoryIndex: group.categoryIndex,
            itemIndex: group.entries[rowIndex].itemIndex,
          })))}
      </div>
    );

  return (
    <section aria-label="Extraction result" className="flex flex-col gap-4">
      <Attention
        active={allClear}
        pulse={false}
        scrollBlock="start"
        className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-5 scroll-mt-4"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-stone-900">{data.title ?? "Untitled menu"}</h2>
            {source === "ai" ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                {reviewCount > 0 ? `AI draft — ${reviewCount} to check` : "AI draft"}
              </span>
            ) : (
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                Demo data
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {data.categories.length} {data.categories.length === 1 ? "category" : "categories"} ·{" "}
            {itemCount} {itemCount === 1 ? "item" : "items"}
            {reviewCount > 0 && (
              <span className="font-medium text-amber-800">
                {" "}· {reviewCount} to check
              </span>
            )}
          </p>
          {source === "ai" && (
            <p className="mt-1 text-xs text-stone-500">
              Prices and names are a best-effort draft. Check anything marked before using it.
            </p>
          )}
          {savedNotice && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-900">
              <span aria-hidden="true">✓</span>
              {savedNotice}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onPublish && (
            <Attention active={linkReady} scroll={false} inline className="inline-flex rounded-full">
              <button
                type="button"
                onClick={handleContinue}
                className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                {reviewCount > 0
                  ? `Continue → check prices (${reviewCount})`
                  : "Get your link →"}
              </button>
            </Attention>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className={
                onPublish
                  ? "rounded-full px-4 py-1.5 text-sm font-medium text-stone-500 transition-colors hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                  : "rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              }
            >
              {onPublish ? "Fine-tune in the editor" : editLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onStartOver}
            className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Start over
          </button>
        </div>
      </Attention>

      {previewDoc ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <aside className="flex flex-col gap-2 lg:sticky lg:top-4">
            <PhoneFrame label="Your draft as a guest would see it">
              <MenuPreview doc={previewDoc} eyebrow="Preview · not published" />
            </PhoneFrame>
          </aside>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-amber-800 uppercase">
                First look
              </p>
              <h3 className="mt-1 text-lg font-bold text-stone-900">
                This is your menu on a phone
              </h3>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Nothing is public yet. Check anything marked, then get your link when it looks
                right.
              </p>
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
                {onlyFlagged ? "Items to check" : "Full draft"}
              </h3>
              <div className="flex items-baseline gap-3">
                {reviewCount > 0 && (
                  <span className="text-xs text-amber-800">{reviewCount} to check</span>
                )}
                {reviewCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyFlagged((value) => !value)}
                    aria-pressed={onlyFlagged}
                    className="text-xs font-medium text-stone-500 underline underline-offset-2 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
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

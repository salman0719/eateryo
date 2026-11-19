/**
 * Shared diner-facing pieces of the table ordering screen: the page frame,
 * the cover header, the search field, the category rail + scroll-spy, the
 * add-to-order menu list, and total formatting. Used by the live table
 * landing (`/r/<restaurant>/t/<table>`) and the owner preview
 * (`OrderPagePreview`, a draft single menu with ordering off) so a diner
 * sees the same menu whichever path the café uses.
 *
 * Deliberately free of editing chrome and of any storage import: the server
 * page must not pull IndexedDB code into its bundle just to render a menu.
 */

"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { BrandLockup } from "@/components/ui/brand";
import { ScrollArrowStrip } from "@/components/ui/scroll-arrow-strip";
import { Skeleton } from "@/components/ui/skeleton";
import type { MenuCategory, MenuItem, MenuItemImage } from "@/features/menu/schema";
import { dedupeDietaryLabels } from "@/features/menu/dietary-labels";
import {
  priceWithOptions,
  validateOptionSelections,
  type OptionSelection,
} from "@/features/menu/option-groups";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";

import { itemImageCopy } from "@/features/item-images/ref";
import { ClampedDescription } from "./clamped-description";
import { CustomizeSheet } from "./customize-sheet";
import { MenuItemPhoto } from "./menu-item-photo";
import { toggleOptionSelection } from "./option-groups";

/**
 * Loading placeholder for the diner-facing order surfaces: a menu card in
 * the shape the loaded content lands in, so a slow table connection shows
 * the page's outline instead of one centered line. `label` announces the
 * wait to assistive tech; the blocks themselves are decorative.
 */
export function OrderSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="rounded-2xl border border-line-200 bg-surface-base p-6"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <div className="mt-6 flex flex-col gap-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderShell({
  tableLabel,
  bare = false,
  children,
}: {
  tableLabel?: string;
  /**
   * Diner pages hide the frame header (brand lockup + table pill): the
   * cover header below already names the restaurant and the table, so the
   * shell's row would repeat the table and add a second brand.
   */
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4 px-4 py-6">
      {!bare && (
        <header className="flex items-center justify-between gap-3">
          <BrandLockup tagline="Order from your table" />
          {tableLabel && (
            <span className="rounded-full border border-warning-300 bg-warning-50 px-3 py-1 text-xs font-semibold text-warning-900">
              {formatTableLabel(tableLabel)}
            </span>
          )}
        </header>
      )}
      {children}
    </div>
  );
}

/**
 * Prototype A identity header for the diner pages: a slim cover band, an
 * overlapping initial tile, the restaurant name, and one sub-line (the menu
 * title on a single-menu page, the table summary on the landing page).
 *
 * There is no cover photo in the schema yet, so the band is a gradient drawn
 * from the `accent` role tokens via `var(--color-accent-*)`: a theme change
 * repaints it with no code change, and a photo later replaces the band's
 * background only. The name always sits below the band — never on it — so
 * any photo stays legible without a scrim. The table sits top-right of the
 * band as a filled pill; `OrderShell` already carries it in non-bare mode.
 */
export function DinerCoverHeader({
  restaurantName,
  tableLabel,
  subline,
}: {
  restaurantName: string;
  /** The diner's table: a filled pill top-right of the cover band. */
  tableLabel?: string;
  /** One quiet line under the name: the menu title on a single-menu page. */
  subline?: string;
}) {
  const initial = restaurantName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="overflow-hidden rounded-2xl border border-line-200 bg-surface-base">
      <div
        aria-hidden={tableLabel ? undefined : "true"}
        className="relative h-24"
        style={{
          backgroundImage:
            "linear-gradient(120deg, var(--color-accent-800), var(--color-accent-600) 55%, var(--color-accent-800))",
        }}
      >
        {tableLabel && (
          <span className="absolute top-3 right-3 rounded-full bg-surface-base px-3 py-1 text-xs font-semibold text-ink-900">
            {formatTableLabel(tableLabel)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 px-5 pb-4">
        <span
          aria-hidden="true"
          className="relative z-10 -mt-7 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-surface-base bg-surface-900 text-xl font-bold text-on-accent"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-snug font-bold text-ink-900">{restaurantName}</h1>
          {subline && <p className="truncate text-sm text-ink-600">{subline}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * The search field every diner ordering surface shares: the same input,
 * the same placeholder, the same match-count line. `resultText` is the
 * already-counted line (null hides it), so single- and multi-menu callers
 * count differently but read identically.
 */
export function DinerSearchField({
  value,
  onChange,
  placeholder = "Search dishes…",
  resultText,
  id = "diner-dish-search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The counted line under the input; null renders no line. */
  resultText: string | null;
  id?: string;
}) {
  return (
    <>
      <label className="block" htmlFor={id}>
        <span className="sr-only">Search dishes</span>
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-line-300 bg-surface-base px-3 py-2 text-sm placeholder:text-ink-500 focus:border-accent-700 focus:outline-none"
        />
      </label>
      {resultText !== null && (
        <p className="mt-2 text-xs text-ink-500" role="status">
          {resultText}
        </p>
      )}
    </>
  );
}

/** Jump to a category section, honouring reduced motion. */
export function scrollToCategory(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * Prototype A category rail: the sticky pill row above the dishes.
 * `ScrollArrowStrip` owns the sideways scroll; this owns which pill reads
 * active. Active follows the viewport (see `useScrollSpyCategory`); a tap
 * jumps to that category's section.
 */
export function CategoryRail({
  categories,
  activeId,
  onSelect,
}: {
  categories: { id: string; label: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="sticky top-0 z-20 -mx-4 -mt-3 border-b border-line-200 bg-surface-50/95 px-4 py-2 backdrop-blur">
      <ScrollArrowStrip label="Menu categories">
        {categories.map((category) => {
          const active = category.id === activeId;
          return (
            <button
              key={category.id}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(category.id)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "border-accent-700 bg-accent-700 text-on-accent shadow-sm"
                  : "border-line-300 bg-surface-base text-ink-700 hover:border-accent-700 hover:text-accent-900"
              }`}
            >
              {category.label}
            </button>
          );
        })}
      </ScrollArrowStrip>
    </div>
  );
}

/**
 * Scroll-spy for the category rail: the id of the category nearest the top
 * of the viewport. The band sits below the sticky rail and above the fold's
 * bottom, so the pill changes as the diner moves through the menu, not after.
 * When nothing intersects (fast fling between sections) the last answer
 * stands instead of flickering to null.
 */
export function useScrollSpyCategory(ids: string[]): string | null {
  const key = ids.join("|");
  const [active, setActive] = useState<string | null>(() => ids[0] ?? null);
  // The list is stable per document; when it does change, reset the pill
  // with a render-time adjustment (the endorsed pattern), not an effect,
  // so there is no cascading update.
  const [watched, setWatched] = useState(key);
  if (watched !== key) {
    setWatched(key);
    const list = key.split("|").filter(Boolean);
    setActive((current) => (current && list.includes(current) ? current : (list[0] ?? null)));
  }
  useEffect(() => {
    const list = key.split("|").filter(Boolean);
    if (list.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0];
        if (top && top.target.id) setActive(top.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    for (const id of list) {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [key]);
  return active;
}

/**
 * One quiet line under a customizable dish: what the Add tap will ask for.
 * Required groups are named (the diner cannot skip them); otherwise the row
 * just says add-ons exist, and the sheet carries the detail.
 */
function CustomizableHint({ item }: { item: MenuItem }) {
  const required = item.options.filter((group) => group.min > 0);
  return (
    <p className="mt-1 text-xs text-ink-500">
      {required.length > 0
        ? `Requires ${required.map((group) => group.name).join(", ")}`
        : "Add-ons available"}
    </p>
  );
}

/**
 * Step 13 of the redesign: the category heading on the diner page
 * (SPEC §5.4, treatment C).
 *
 * A set cover renders as one uniform 72px banner with the title overlaid
 * on a baked-in scrim and the description below it; without a cover the
 * heading is today's band (plus the description when set). Cover and
 * description are each optional. A photo that fails to load hides the
 * banner and falls back to the band — never a broken icon. Plain `<img>`
 * from the CDN like dish photos (the optimizer must never touch editor
 * images); the banner reuses the dish display rendition, so no new size.
 */
function CategoryHeading({ category }: { category: MenuCategory }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const cover: MenuItemImage | null = !coverFailed && category.cover ? category.cover : null;
  return (
    <>
      {cover ? (
        <div className="relative h-[72px] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- category cover served straight from the CDN at its stored size; the optimizer must never touch it */}
          <img
            src={cover.url}
            alt=""
            width={cover.width}
            height={cover.height}
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div aria-hidden="true" className="absolute inset-0 bg-scrim" />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-t from-scrim to-transparent"
          />
          {/* White reads on any owner photo; no theme role can name "light
              text over an arbitrary photo", so the raw utility stays on
              this bespoke banner with this comment (AGENTS.md). */}
          <h2 className="absolute inset-x-0 bottom-0 truncate px-5 pb-2 text-xl font-bold text-white">
            {category.name}
          </h2>
        </div>
      ) : (
        <h2 className="border-b border-line-100 bg-surface-50 px-5 py-2.5 text-xl font-bold tracking-wide text-ink-800 uppercase">
          {category.name}
        </h2>
      )}
      {category.description ? (
        <p className="border-b border-line-100 bg-surface-base px-5 py-2 text-xs leading-5 text-ink-600">
          {category.description}
        </p>
      ) : null}
    </>
  );
}

export function OrderMenuSection({
  category,
  currency,
  variantChoice,
  onVariantChange,
  onAdd,
}: {
  category: MenuCategory;
  currency: string | null;
  variantChoice: Record<string, string>;
  onVariantChange: (itemId: string, name: string) => void;
  /** Add a dish with the diner's current picks for its option groups. */
  onAdd: (item: MenuItem, selections: OptionSelection[]) => void;
}) {
  // Per-item confirmation: pops on every tap, gone ~2s later. A fresh tap
  // dismisses the visible pop instantly and replays it, so rapid taps
  // never stack or linger. Removal is timer-driven (animation end is
  // unreliable when the node remounts mid-flight).
  const [flash, setFlash] = useState<Record<string, number>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashSeq = useRef(0);
  /** The diner's current picks per dish, cleared for a dish once added. */
  const [optionChoice, setOptionChoice] = useState<Record<string, OptionSelection[]>>({});
  /** Add-gate message per dish (a required group left unanswered). */
  const [optionError, setOptionError] = useState<Record<string, string | null>>({});
  /** Dish whose groups are open in the customizer sheet (null: shut). */
  const [customizingId, setCustomizingId] = useState<string | null>(null);
  useEffect(
    () => () => {
      for (const timer of Object.values(flashTimers.current)) clearTimeout(timer);
    },
    []
  );
  function hideFlash(itemId: string) {
    setFlash((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }
  function togglePick(item: MenuItem, groupName: string, choiceName: string) {
    const group = item.options.find((candidate) => candidate.name === groupName);
    if (!group) return;
    setOptionChoice((current) => ({
      ...current,
      [item.id]: toggleOptionSelection(current[item.id] ?? [], group, choiceName),
    }));
    setOptionError((current) => ({ ...current, [item.id]: null }));
  }
  function confirmCustomizing(item: MenuItem, picks: OptionSelection[]) {
    const problem = validateOptionSelections(item, picks);
    if (problem) {
      setOptionError((current) => ({ ...current, [item.id]: problem }));
      return;
    }
    onAdd(item, picks);
    bumpFlash(item.id);
    // A confirmed add starts blank next time: the cart holds the record, so
    // the row and the sheet never echo the last configuration.
    setOptionChoice((current) => {
      if (!(item.id in current)) return current;
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setOptionError((current) => ({ ...current, [item.id]: null }));
    setCustomizingId(null);
  }
  /** One photo in the list earns every row a thumb: photo rows keep their
      image while the rest hold an initial tile, so the text stays aligned. */
  const showPlaceholders = category.items.some((candidate) => itemImageCopy(candidate.image));
  const customizing =
    customizingId === null
      ? null
      : (category.items.find((candidate) => candidate.id === customizingId) ?? null);
  const customizingVariantName = customizing
    ? (variantChoice[customizing.id] ?? customizing.variants[0]?.name ?? null)
    : null;
  const customizingPrice = customizing
    ? (customizing.variants.find((candidate) => candidate.name === customizingVariantName)?.price ??
      customizing.price)
    : null;
  function bumpFlash(itemId: string) {
    // Drop the visible pop first so the replay starts from a clean mount.
    hideFlash(itemId);
    flashSeq.current += 1;
    const seq = flashSeq.current;
    requestAnimationFrame(() => {
      const pending = flashTimers.current[itemId];
      if (pending !== undefined) clearTimeout(pending);
      setFlash((current) => ({ ...current, [itemId]: seq }));
      flashTimers.current[itemId] = setTimeout(() => {
        delete flashTimers.current[itemId];
        hideFlash(itemId);
      }, 2000);
    });
  }
  return (
    <section
      aria-label={category.name}
      className="overflow-hidden rounded-2xl border border-line-200 bg-surface-base"
    >
      <CategoryHeading category={category} />
      <ul className="divide-y divide-line-100">
        {category.items.map((item) => {
          const soldOut = item.available === false;
          // One chip per diet: an older document (or a CSV import) can hold the
          // same label twice, which used to mean duplicate keys and two
          // identical chips on the diner's screen.
          const dietaryLabels = dedupeDietaryLabels(item.dietaryLabels);
          const variantName = variantChoice[item.id] ?? item.variants[0]?.name ?? null;
          const variant = variantName
            ? item.variants.find((candidate) => candidate.name === variantName)
            : null;
          const price = variant ? variant.price : item.price;
          const picks = optionChoice[item.id] ?? [];
          const livePrice = priceWithOptions(price, item, picks);
          // The button always starts a NEW add at the shown price — it never
          // reports cart contents. Counts live in the cart (sticky bar, side
          // panel, sheet) alone, so reopening a row or the sheet cannot read
          // as a lost order, and plain and customizable dishes label alike.
          // Unpriced keeps the bare label: nothing is invented.
          const addLabel =
            livePrice === null ? "Add" : `Add · ${formatPreviewPrice(livePrice, null, currency)}`;
          const tick = flash[item.id] ?? 0;
          return (
            <li key={item.id} className={`px-5 py-3.5 ${soldOut ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <MenuItemPhoto item={item} showPlaceholder={showPlaceholders} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-ink-900">
                    <span>{item.name}</span>
                    {soldOut && (
                      <span className="shrink-0 rounded-full bg-surface-200 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                        Sold out
                      </span>
                    )}
                  </p>
                  {/* Clamped to two lines with a "More" control: a long
                      description must not push Add away from its dish (009). */}
                  {item.description && (
                    <ClampedDescription text={item.description} name={item.name} />
                  )}
                  {item.options.length > 0 && <CustomizableHint item={item} />}
                  {dietaryLabels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dietaryLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-ink-700"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
                  {formatPreviewPrice(livePrice, null, currency)}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.variants.length > 0 && (
                  <label className="text-xs text-ink-600">
                    <span className="sr-only">Size for {item.name}</span>
                    <select
                      value={variant?.name ?? ""}
                      onChange={(event) => onVariantChange(item.id, event.target.value)}
                      className="rounded-full border border-line-300 bg-surface-base px-3 py-1 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
                    >
                      {item.variants.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.name}
                          {option.price !== null
                            ? ` — ${formatPreviewPrice(option.price, null, currency)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="relative inline-flex">
                  {tick > 0 && (
                    <span
                      key={tick}
                      aria-hidden="true"
                      className="added-flash absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-accent-800 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-on-accent shadow"
                    >
                      Added ✓
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => {
                      // Plain dishes add straight from the row. Customizable
                      // ones open the sheet: the picking and the Add-gate live
                      // there now, not in the menu list.
                      if (item.options.length === 0) {
                        onAdd(item, picks);
                        bumpFlash(item.id);
                        return;
                      }
                      setCustomizingId(item.id);
                    }}
                    className="rounded-full bg-surface-900 px-3.5 py-1.5 text-xs font-semibold text-on-accent transition-all hover:bg-surface-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {addLabel}
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {customizing && (
        <CustomizeSheet
          item={customizing}
          variantName={customizingVariantName}
          basePrice={customizingPrice}
          currency={currency}
          picks={optionChoice[customizing.id] ?? []}
          error={optionError[customizing.id] ?? null}
          onToggle={(groupName, choiceName) => togglePick(customizing, groupName, choiceName)}
          onConfirm={() => confirmCustomizing(customizing, optionChoice[customizing.id] ?? [])}
          onClose={() => setCustomizingId(null)}
        />
      )}
    </section>
  );
}

export function formatOrderTotal(currency: string | null, total: number | null): string {
  if (total === null) return "—";
  return formatPreviewPrice(total, null, currency);
}

/**
 * The cart shortcut for a one-column (phone) diner page: once something is in
 * the order, this bar shows the count and total and opens the order sheet.
 * A phone has no room for a cart beside the dishes, so "View order" is the
 * only way in there.
 *
 * Callers mount it only on narrow screens (`useWideLayout`); a wide page puts
 * the order in its own sticky column instead, and the bar would cover content
 * the panel already shows. The spacer reserves room at the end of the page so
 * the bar never covers the last dish.
 *
 * `contained` is for the owner-facing preview, which renders inside a phone
 * frame in the editor and wizard and is phone-shaped at every viewport width,
 * so it always needs the bar. There the viewport-bottom bar would float over
 * the app instead of the preview, so the bar sticks to the bottom of the
 * frame's own scroll area and the page does not need the spacer. Its `-mb-6`
 * cancels `OrderShell`'s bottom padding so the bar reaches the screen edge;
 * it is only correct inside that shell.
 */
export function StickyCartBar({
  itemCount,
  total,
  currency,
  contained = false,
  onViewOrder,
  buttonRef,
}: {
  itemCount: number;
  total: number | null;
  currency: string | null;
  contained?: boolean;
  /** Opens the order sheet; every cart lives there. */
  onViewOrder: () => void;
  /** Lets the caller return focus here after closing the order sheet. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  if (itemCount === 0) return null;

  const inner = (
    <div className="mx-auto flex w-full items-center gap-3">
      <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
        <span className="font-bold text-ink-900">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>{" "}
        · {formatOrderTotal(currency, total)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        onClick={onViewOrder}
        className="shrink-0 rounded-full bg-accent-700 px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 active:scale-95"
      >
        View order
      </button>
    </div>
  );

  if (contained) {
    return (
      <div
        className="sticky bottom-0 z-10 -mx-4 -mb-6 mt-auto border-t border-line-200 bg-surface-base/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {inner}
      </div>
    );
  }

  return (
    <>
      <div aria-hidden="true" className="h-16" />
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line-200 bg-surface-base/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-4xl">{inner}</div>
      </div>
    </>
  );
}

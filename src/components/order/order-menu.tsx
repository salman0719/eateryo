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
import { PlateIcon, PlusIcon } from "@/components/ui/icons";
import { ScrollArrowStrip } from "@/components/ui/scroll-arrow-strip";
import { Skeleton } from "@/components/ui/skeleton";
import type { MenuCategory, MenuItem, MenuItemImage } from "@/features/menu/schema";
import { dedupeDietaryLabels } from "@/features/menu/dietary-labels";
import { brandAssetCopy } from "@/features/brand-assets/ref";
import type { BrandAssetImage } from "@/features/brand-assets/schema";
import {
  priceWithOptions,
  validateOptionSelections,
  type OptionSelection,
} from "@/features/menu/option-groups";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";

import { itemImageCopy } from "@/features/item-images/ref";
import { CustomizeSheet } from "./customize-sheet";
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
            <Skeleton className="h-8 w-8 rounded-full" />
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
 * overlapping logo tile, the restaurant name, and one sub-line (the menu
 * title on a single-menu page, the table summary on the landing page).
 *
 * Without brand assets the band is a gradient drawn from the `accent` role
 * tokens via `var(--color-accent-*)`, and the tile is the name's initial: a
 * theme change repaints it with no code change. A cover photo replaces the
 * band's background only, a logo replaces the tile only. The name always
 * sits below the band — never on it — so any photo stays legible without a
 * scrim. The table sits top-right of the band as a filled pill; `OrderShell`
 * already carries it in non-bare mode.
 */
export function DinerCoverHeader({
  restaurantName,
  tableLabel,
  subline,
  logo = null,
  cover = null,
  bleed = false,
}: {
  restaurantName: string;
  /** The diner's table: a filled pill top-right of the cover band. */
  tableLabel?: string;
  /** One quiet line under the name: the menu title on a single-menu page. */
  subline?: string;
  /** The restaurant's logo: a 56px tile when set, the initial otherwise. */
  logo?: BrandAssetImage | null;
  /** The restaurant's cover photo: the band background when set. */
  cover?: BrandAssetImage | null;
  /**
   * On a phone the cover is the page's own top edge: the band reaches the
   * viewport top and both sides with no page padding, and the card framing
   * comes back from `sm` up. The negative margins cancel `OrderShell`'s
   * `px-4 py-6`, which is where the inset came from. The owner preview
   * bleeds the same way inside its phone frame, so it reads edge to edge
   * like the table page; its notice sits below the cover to keep the top
   * edge clear.
   */
  bleed?: boolean;
}) {
  const initial = restaurantName.trim().charAt(0).toUpperCase() || "?";
  // A failed photo falls back to the gradient band / initial tile — never a
  // broken icon. The band loads the display copy (up to ~896px wide at 2x);
  // the 56px tile takes the thumb when one was uploaded.
  const [coverFailed, setCoverFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const coverCopy = !coverFailed && cover ? cover : null;
  const logoCopy = !logoFailed ? brandAssetCopy(logo) : null;
  return (
    <div
      className={
        bleed
          ? "diner-cover-bleed -mx-4 -mt-6 overflow-hidden border-b border-line-200 bg-surface-base sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border"
          : "overflow-hidden rounded-2xl border border-line-200 bg-surface-base"
      }
    >
      <div
        aria-hidden={tableLabel ? undefined : "true"}
        className="relative h-24"
        style={
          coverCopy
            ? undefined
            : {
                backgroundImage:
                  "linear-gradient(120deg, var(--color-accent-800), var(--color-accent-600) 55%, var(--color-accent-800))",
              }
        }
      >
        {coverCopy && (
          // eslint-disable-next-line @next/next/no-img-element -- cover served straight from the CDN at its stored size; the optimizer must never touch it
          <img
            src={coverCopy.url}
            alt=""
            width={coverCopy.width}
            height={coverCopy.height}
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {tableLabel && (
          <span className="absolute top-3 right-3 rounded-full bg-surface-base px-3 py-1 text-xs font-semibold text-ink-900">
            {formatTableLabel(tableLabel)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 px-5 pb-4">
        {logoCopy ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo served straight from the CDN at its stored size; the optimizer must never touch it
          <img
            src={logoCopy.url}
            alt=""
            width={logoCopy.width}
            height={logoCopy.height}
            loading="lazy"
            decoding="async"
            onError={() => setLogoFailed(true)}
            className="relative z-10 -mt-7 h-14 w-14 shrink-0 rounded-2xl border-2 border-surface-base bg-surface-base object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="relative z-10 -mt-7 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-surface-base bg-surface-900 text-xl font-bold text-on-accent"
          >
            {initial}
          </span>
        )}
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
  const railRef = useRef<HTMLDivElement>(null);
  // Scrolling the dishes moves the active pill; keep that pill in view so the
  // rail mirrors the section without the diner chasing it. The strip is what
  // scrolls, never the page: `scrollIntoView` walks every scrollable ancestor,
  // so where the rail starts below the fold — the embedded preview in capture's
  // review and publish stops — it dragged the whole page down to the pill row.
  useEffect(() => {
    if (!activeId) return;
    const track = railRef.current?.querySelector<HTMLElement>('[role="region"], nav[aria-label]');
    const pill = track?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!track || !pill) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const trackBox = track.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    // Centre by measurement, not `offsetLeft`: a pill's offset parent is not
    // the track, so its offsets live in a different frame.
    track.scrollTo({
      left:
        track.scrollLeft + (pillBox.left - trackBox.left) - (trackBox.width - pillBox.width) / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [activeId]);
  if (categories.length === 0) return null;
  return (
    <div
      ref={railRef}
      className="sticky top-0 z-20 -mx-4 -mt-3 border-b border-line-200 bg-surface-50/95 px-4 py-2 backdrop-blur"
    >
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
        <h2 className="border-b border-line-100 bg-surface-50 px-5 py-2.5 text-lg font-bold tracking-wide text-ink-800 uppercase">
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

/**
 * The category list. On a phone it runs edge to edge — no page padding, no
 * rounded cards — and the categories are separated by a short bare gutter
 * rather than a hairline, so a category that opens on a photo is visibly a
 * new one even though the photo itself has no card edge. The width above
 * `sm` keeps the inset, rounded cards the desktop page was designed around.
 *
 * The negative margin cancels `OrderShell`'s `px-4`; the sections themselves
 * give up their borders and radius below `sm` (see `OrderMenuSection`), so
 * the gutters here are the only separation between categories.
 */
export function CategorySections({ children }: { children: React.ReactNode }) {
  return (
    <div className="diner-category-sections -mx-4 flex min-w-0 flex-col divide-y-8 divide-surface-100 border-y border-line-200 bg-surface-base sm:mx-0 sm:gap-4 sm:divide-y-0 sm:border-0 sm:bg-transparent">
      {children}
    </div>
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
  /** One photo in the category keeps every card's media slot: photo cards
      show their image while photo-less ones show the pattern tile, so the
      rail keeps a steady shape. A category with no photos at all goes
      text-first instead — no empty media boxes. */
  const hasPhoto = category.items.some((candidate) => itemImageCopy(candidate.image));
  /** One roomy dish makes the whole category roomy: a mixed rail would pair
      tall stacked cards with short railed ones, so the category picks one
      shape and every card keeps it. Plain-only categories stay railed. */
  const roomyCategory = category.items.some(
    (candidate) => candidate.description || candidate.variants.length > 0
  );
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
      // A phone gets the category edge to edge (see `CategorySections`); the
      // inset card is the wide-screen treatment.
      className="diner-menu-section overflow-hidden bg-surface-base sm:rounded-2xl sm:border sm:border-line-200"
    >
      <CategoryHeading category={category} />
      {/* Dish carousel (prototype): a snapping row of photo cards through the
          shared `ScrollArrowStrip`, so edge arrows, keyboard and no-bar
          scrolling all behave like the category rails. The next card peeks
          in so the row reads as swipeable; ~1.6 cards fit at once. */}
      <div className="px-5 py-3">
        <ScrollArrowStrip
          as="ul"
          label={`${category.name} dishes`}
          trackClassName="snap-x snap-mandatory items-stretch gap-3 py-0.5"
        >
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
            // panel, sheet) alone, so reopening a card or the sheet cannot read
            // as a lost order, and plain and customizable dishes label alike.
            // Unpriced keeps the bare label: nothing is invented.
            const addAccessibilityLabel =
              livePrice === null
                ? `Add ${item.name}`
                : `Add ${item.name} · ${formatPreviewPrice(livePrice, null, currency)}`;
            const tick = flash[item.id] ?? 0;
            const photo = itemImageCopy(item.image);
            // Pattern tile for a photo-less dish in a photographed category;
            // text-first (no media at all) when the category has no photos.
            const textFirst = !photo && !hasPhoto;
            // The category picked this card's shape: roomy when any dish needs
            // the width, railed when every dish is plain.
            const roomy = roomyCategory;
            // The Add control lives in one place so the two layouts cannot drift.
            const addControl = (
              <span className="relative inline-flex flex-none items-center">
                {tick > 0 && (
                  <span
                    key={tick}
                    aria-hidden="true"
                    // Centred on the button and parked to its left: a pop above
                    // the button sticks out past the card's top edge, where the
                    // carousel track (overflow-x-auto forces a clipped
                    // overflow-y) cuts it off — worst on short text-first
                    // cards like name-and-price-only dishes. Centred vertically
                    // it stays inside the card's height, and extending left it
                    // hangs over the card's own interior, so neither the card
                    // edge nor the viewport can clip it, even on end cards.
                    className="added-flash absolute top-1/2 right-10 -translate-y-1/2 rounded-full bg-accent-800 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-on-accent shadow pointer-events-none z-10"
                  >
                    Added ✓
                  </span>
                )}
                <button
                  type="button"
                  disabled={soldOut}
                  aria-label={addAccessibilityLabel}
                  onClick={() => {
                    // Plain dishes add straight from the card. Customizable
                    // ones open the sheet: the picking and the Add-gate live
                    // there now, not in the menu list.
                    if (item.options.length === 0) {
                      onAdd(item, picks);
                      bumpFlash(item.id);
                      return;
                    }
                    setCustomizingId(item.id);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full bg-accent-700 text-on-accent transition-all hover:bg-accent-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <PlusIcon size={16} />
                </button>
              </span>
            );
            return (
              <li
                key={item.id}
                // No overflow clip on the card itself: the Added pop sits above
                // the rail button and is wider than it, so a clip here would
                // cut it off at the card's edge. The media slot below carries
                // its own clip for the rounded top corners instead.
                className={`flex w-[200px] shrink-0 snap-start flex-col rounded-xl border border-line-200 bg-surface-base ${soldOut ? "opacity-60" : ""}`}
              >
                {!textFirst && (
                  <div
                    className={`grid h-28 place-items-center overflow-hidden rounded-t-[11px] bg-surface-100 ${photo ? "" : "dish-photo-fallback"}`}
                    // The dot texture is the `line` role token used as a
                    // pattern wash — no new colour, just the token drawn as
                    // dots because Tailwind has no dotted-background utility.
                    style={
                      photo
                        ? undefined
                        : {
                            backgroundImage:
                              "radial-gradient(circle, var(--color-line-200) 1px, transparent 1.3px)",
                            backgroundSize: "10px 10px",
                          }
                    }
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- dish photo served straight from the CDN at its stored size; the optimizer must never touch it
                      <img
                        src={photo.url}
                        alt=""
                        width={photo.width}
                        height={photo.height}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <PlateIcon size={34} className="text-ink-400" />
                    )}
                  </div>
                )}
                <div className={`flex flex-1 gap-2 p-2.5 ${textFirst ? "dish-text-first" : ""}`}>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="flex items-center gap-2 font-medium text-ink-900">
                      <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug">
                        {item.name}
                      </span>
                      {soldOut && (
                        <span className="shrink-0 rounded-full bg-surface-200 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                          Sold out
                        </span>
                      )}
                    </p>
                    {item.description && (
                      <p className="truncate text-xs text-ink-600" title={item.description}>
                        {item.description}
                      </p>
                    )}
                    {item.options.length > 0 && <CustomizableHint item={item} />}
                    {dietaryLabels.length > 0 && (
                      <div className="flex flex-wrap gap-1">
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
                    {item.variants.length > 0 && (
                      <label className="mt-1 inline-block max-w-full text-xs text-ink-600">
                        <span className="sr-only">Size for {item.name}</span>
                        <select
                          value={variant?.name ?? ""}
                          onChange={(event) => onVariantChange(item.id, event.target.value)}
                          className="max-w-full rounded-full border border-line-300 bg-surface-base px-3 py-1 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
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
                    {roomy ? (
                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <p className="text-sm font-semibold tabular-nums text-ink-900">
                          {formatPreviewPrice(livePrice, null, currency)}
                        </p>
                        {addControl}
                      </div>
                    ) : (
                      <p className="mt-auto pt-1 text-sm font-semibold tabular-nums text-ink-900">
                        {formatPreviewPrice(livePrice, null, currency)}
                      </p>
                    )}
                  </div>
                  {!roomy && <div className="flex flex-none items-center">{addControl}</div>}
                </div>
              </li>
            );
          })}
        </ScrollArrowStrip>
      </div>
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
        className="sticky bottom-0 z-10 -mx-4 -mb-6 mt-auto border-t border-line-300 bg-surface-base px-4 pt-3 shadow-[0_-8px_24px_rgb(0_0_0/0.12)]"
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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line-300 bg-surface-base px-4 pt-3 shadow-[0_-8px_24px_rgb(0_0_0/0.12)]"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-4xl">{inner}</div>
      </div>
    </>
  );
}

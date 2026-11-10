/**
 * What diners would see differently if the owner pressed "Publish changes".
 *
 * `hasUnpublishedChanges` is only a timestamp comparison (see `repo.ts`), so
 * this module compares the live revision against the draft. It is a summary,
 * not a side-by-side view: two phone-sized menus next to each other are
 * unreadable, and the live menu is not something the owner needs to browse —
 * what they need is the delta they are about to publish.
 *
 * Items and categories are matched by id, never by name or position, so a
 * rename reads as a rename and moving a dish between sections is not reported
 * as a removal plus an addition. Nothing here invents a value: a missing price
 * compares as an em dash.
 *
 * Everything the diner page renders is compared — name, price, photo,
 * availability, description, dietary labels, and the order of both sections
 * and dishes. A field this module does not look at is *unexamined*, not
 * unchanged, so the panel never claims more than these rows can prove.
 */

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { formatPreviewPrice, formatPriceDelta } from "@/features/menu/preview-utils";
import { itemImageKey } from "@/features/item-images/ref";

export type MenuChangeKind =
  | "title"
  | "currency"
  | "category"
  | "added"
  | "removed"
  | "renamed"
  | "repriced"
  | "photo"
  | "availability"
  | "description"
  | "labels"
  | "options"
  | "moved";

export interface MenuChange {
  kind: MenuChangeKind;
  /** The draft's name where the thing still exists, otherwise the old name. */
  name: string;
  /** Old → new, or the reason, when the name alone does not say it. */
  detail: string | null;
}

export interface MenuChangeSummary {
  rows: MenuChange[];
  /** Rows per kind, for the one-line summary. */
  counts: Record<MenuChangeKind, number>;
}

/** Counts in the order a reader scans them: dishes first, metadata last. */
export const MENU_CHANGE_ORDER: MenuChangeKind[] = [
  "added",
  "removed",
  "renamed",
  "repriced",
  "photo",
  "availability",
  "description",
  "labels",
  "options",
  "moved",
  "category",
  "title",
  "currency",
];

export const MENU_CHANGE_LABEL: Record<MenuChangeKind, string> = {
  added: "added",
  removed: "removed",
  renamed: "renamed",
  repriced: "repriced",
  photo: "photo",
  availability: "status",
  description: "description",
  labels: "label",
  options: "options",
  moved: "moved",
  category: "section",
  title: "title",
  currency: "currency",
};

function priceLabel(price: number | null, currency: string | null): string {
  return formatPreviewPrice(price, null, currency);
}

/**
 * Price changes for one item: the item's own price plus its size variants,
 * matched by variant name. Returns null when nothing about the pricing moved.
 */
function priceDetail(before: MenuItem, after: MenuItem, currency: string | null): string | null {
  const parts: string[] = [];
  if (before.price !== after.price) {
    parts.push(`${priceLabel(before.price, currency)} → ${priceLabel(after.price, currency)}`);
  }
  for (const variant of after.variants) {
    const previous = before.variants.find((candidate) => candidate.name === variant.name);
    if (!previous) {
      parts.push(`${variant.name} added`);
      continue;
    }
    if (previous.price !== variant.price) {
      parts.push(
        `${variant.name} ${priceLabel(previous.price, currency)} → ${priceLabel(
          variant.price,
          currency
        )}`
      );
    }
  }
  for (const variant of before.variants) {
    if (!after.variants.some((candidate) => candidate.name === variant.name)) {
      parts.push(`${variant.name} removed`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function emptyCounts(): Record<MenuChangeKind, number> {
  return {
    title: 0,
    currency: 0,
    category: 0,
    added: 0,
    removed: 0,
    renamed: 0,
    repriced: 0,
    photo: 0,
    availability: 0,
    description: 0,
    labels: 0,
    options: 0,
    moved: 0,
  };
}

/** Bound text for a min/max rule: null max means no upper bound. */
function boundLabel(bound: number | null): string {
  return bound === null ? "no limit" : String(bound);
}

/**
 * Add-on changes for one item: groups and choices matched by name (extraction
 * produces names, not ids), one row per dish so a pizza rebuild stays one
 * line. Rule flips that change what the diner must or may pick are reported
 * like any other visible change — "now required" gates Add, after all.
 */
function optionsDetail(before: MenuItem, after: MenuItem): string | null {
  const parts: string[] = [];
  const previousGroups = new Map(before.options.map((group) => [group.name, group]));
  const nextGroups = new Map(after.options.map((group) => [group.name, group]));
  for (const group of after.options) {
    const previous = previousGroups.get(group.name);
    if (!previous) {
      parts.push(`${group.name} added`);
      continue;
    }
    if (previous.required !== group.required) {
      parts.push(group.required ? `${group.name} now required` : `${group.name} now optional`);
    }
    if (previous.selection !== group.selection) {
      parts.push(
        group.selection === "many"
          ? `${group.name} now takes several picks`
          : `${group.name} now takes one pick`
      );
    }
    if (previous.min !== group.min) {
      parts.push(`${group.name}: at least ${previous.min} → ${group.min}`);
    }
    if (previous.max !== group.max) {
      parts.push(`${group.name}: at most ${boundLabel(previous.max)} → ${boundLabel(group.max)}`);
    }
    const previousChoices = new Map(
      previous.choices.map((choice) => [choice.name, choice.priceDelta])
    );
    for (const choice of group.choices) {
      if (!previousChoices.has(choice.name)) {
        parts.push(`${choice.name} added to ${group.name}`);
        continue;
      }
      const oldDelta = previousChoices.get(choice.name) ?? null;
      if (oldDelta !== choice.priceDelta) {
        parts.push(
          `${choice.name} ${formatPriceDelta(oldDelta) || "—"} → ${formatPriceDelta(choice.priceDelta) || "—"}`
        );
      }
    }
    for (const choice of previous.choices) {
      if (!group.choices.some((candidate) => candidate.name === choice.name)) {
        parts.push(`${choice.name} removed from ${group.name}`);
      }
    }
  }
  for (const group of before.options) {
    if (!nextGroups.has(group.name)) parts.push(`${group.name} removed`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A blank description is no description, exactly as the diner page reads it. */
function descriptionOf(item: MenuItem): string {
  return item.description?.trim() ?? "";
}

function sameLabels(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((label, index) => label === after[index]);
}

function labelList(labels: readonly string[]): string {
  return labels.length > 0 ? labels.join(", ") : "none";
}

function sameOrder(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((id, index) => id === after[index]);
}

/** Items of both lists, in their own order, so an add/remove is not a reorder. */
function commonIds(after: readonly string[], before: readonly string[]): string[] {
  return after.filter((id) => before.includes(id));
}

export function summarizeMenuChanges(before: MenuDocument, after: MenuDocument): MenuChangeSummary {
  const rows: MenuChange[] = [];
  const currency = after.currency ?? before.currency;
  const sameCurrency = before.currency === after.currency;

  const beforeTitle = before.title.trim() || "Untitled menu";
  const afterTitle = after.title.trim() || "Untitled menu";
  if (beforeTitle !== afterTitle) {
    rows.push({ kind: "title", name: afterTitle, detail: `“${beforeTitle}” → “${afterTitle}”` });
  }
  if (!sameCurrency) {
    rows.push({
      kind: "currency",
      name: "Currency",
      detail: `${before.currency ?? "none"} → ${after.currency ?? "none"}`,
    });
  }

  // Sections matter when their label changes, and when an *empty* one appears
  // or disappears — that heading is all the diner sees of it, so the dishes
  // inside cannot stand in for it.
  const beforeCategories = new Map(before.categories.map((category) => [category.id, category]));
  const afterCategoryIds = new Set(after.categories.map((category) => category.id));
  for (const category of after.categories) {
    const previous = beforeCategories.get(category.id);
    if (!previous) {
      if (category.items.length === 0) {
        rows.push({ kind: "category", name: category.name, detail: "added" });
      }
      continue;
    }
    if (previous.name !== category.name) {
      rows.push({
        kind: "category",
        name: category.name,
        detail: `was “${previous.name}”`,
      });
    }
  }
  for (const category of before.categories) {
    if (!afterCategoryIds.has(category.id) && category.items.length === 0) {
      rows.push({ kind: "category", name: category.name, detail: "removed" });
    }
  }

  const beforeItems = new Map(
    before.categories.flatMap((category) => category.items).map((item) => [item.id, item])
  );
  const afterItems = new Set(
    after.categories.flatMap((category) => category.items).map((item) => item.id)
  );
  /** Which section each dish was in, for "moved to Food" rows. */
  const beforeSectionOf = new Map(
    before.categories.flatMap((category) => category.items.map((item) => [item.id, category.id]))
  );

  for (const category of after.categories) {
    for (const item of category.items) {
      const previous = beforeItems.get(item.id);
      if (!previous) {
        const price = priceLabel(item.price, currency);
        rows.push({ kind: "added", name: item.name, detail: price === "—" ? null : price });
        continue;
      }
      if (previous.name !== item.name) {
        rows.push({ kind: "renamed", name: item.name, detail: `was “${previous.name}”` });
      }
      if (sameCurrency) {
        const detail = priceDetail(previous, item, currency);
        if (detail) rows.push({ kind: "repriced", name: item.name, detail });
      }
      // A different stored file is a different picture: matching by key (not
      // URL) keeps a replaced photo from hiding behind an unchanged address.
      const photoBefore = itemImageKey(previous.image);
      const photoAfter = itemImageKey(item.image);
      if (photoBefore !== photoAfter) {
        rows.push({
          kind: "photo",
          name: item.name,
          detail: photoAfter === null ? "removed" : photoBefore === null ? "added" : "replaced",
        });
      }
      const wasSoldOut = previous.available === false;
      const soldOut = item.available === false;
      if (wasSoldOut !== soldOut) {
        rows.push({
          kind: "availability",
          name: item.name,
          detail: soldOut ? "now sold out" : "available again",
        });
      }
      // The description is prose under the dish on the diner page; a
      // before/after quote would defeat a scannable list, so it says what
      // happened instead of repeating it.
      const descriptionBefore = descriptionOf(previous);
      const descriptionAfter = descriptionOf(item);
      if (descriptionBefore !== descriptionAfter) {
        rows.push({
          kind: "description",
          name: item.name,
          detail:
            descriptionBefore === "" ? "added" : descriptionAfter === "" ? "removed" : "updated",
        });
      }
      if (!sameLabels(previous.dietaryLabels, item.dietaryLabels)) {
        rows.push({
          kind: "labels",
          name: item.name,
          detail: `${labelList(previous.dietaryLabels)} → ${labelList(item.dietaryLabels)}`,
        });
      }
      const optionChanges = optionsDetail(previous, item);
      if (optionChanges) {
        rows.push({ kind: "options", name: item.name, detail: optionChanges });
      }
    }
  }

  // Ordering is diner-visible even when no field differs: sections render in
  // document order and dishes in array order. Aggregated deliberately — one
  // row per section, one for a section shuffle, one for cross-section moves —
  // because twenty reordered dishes must not become twenty rows.
  const beforeSectionOrder = before.categories.map((category) => category.id);
  const sectionOrder = commonIds(
    after.categories.map((category) => category.id),
    beforeSectionOrder
  );
  // The same ids in the order they had before, so only a real shuffle differs.
  const sectionOrderBefore = commonIds(beforeSectionOrder, sectionOrder);
  if (sectionOrder.length > 1 && !sameOrder(sectionOrder, sectionOrderBefore)) {
    rows.push({ kind: "moved", name: "Sections", detail: "reordered" });
  }

  const movedSections: { name: string; section: string }[] = [];
  for (const category of after.categories) {
    const previous = beforeCategories.get(category.id);
    const previousIds = previous?.items.map((item) => item.id) ?? [];
    for (const item of category.items) {
      const wasIn = beforeSectionOf.get(item.id);
      if (wasIn !== undefined && wasIn !== category.id) {
        movedSections.push({ name: item.name, section: category.name });
      }
    }
    const ordered = commonIds(
      category.items.map((item) => item.id),
      previousIds
    );
    if (ordered.length < 2) continue;
    const orderedBefore = commonIds(previousIds, ordered);
    if (sameOrder(ordered, orderedBefore)) continue;
    const outOfPlace = ordered.filter((id, index) => orderedBefore[index] !== id).length;
    rows.push({
      kind: "moved",
      name: category.name,
      detail: `${outOfPlace} ${outOfPlace === 1 ? "dish" : "dishes"} reordered`,
    });
  }
  if (movedSections.length === 1) {
    const [moved] = movedSections;
    rows.push({ kind: "moved", name: moved.name, detail: `moved to ${moved.section}` });
  } else if (movedSections.length > 1) {
    rows.push({
      kind: "moved",
      name: `${movedSections.length} dishes`,
      detail: "moved between sections",
    });
  }

  // Removals last: gone dishes are the ones an owner double-checks.
  for (const [id, item] of beforeItems) {
    if (!afterItems.has(id)) rows.push({ kind: "removed", name: item.name, detail: null });
  }

  const counts = emptyCounts();
  for (const row of rows) counts[row.kind] += 1;
  return { rows, counts };
}

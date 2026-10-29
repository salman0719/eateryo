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
 */

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { formatPreviewPrice } from "@/features/menu/preview-utils";

export type MenuChangeKind =
  "title" | "currency" | "category" | "added" | "removed" | "renamed" | "repriced" | "availability";

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
  "availability",
  "category",
  "title",
  "currency",
];

export const MENU_CHANGE_LABEL: Record<MenuChangeKind, string> = {
  added: "added",
  removed: "removed",
  renamed: "renamed",
  repriced: "repriced",
  availability: "status",
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
    availability: 0,
  };
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

  // Sections only matter when their label changes: a whole section added or
  // removed is already counted by the dishes inside it.
  const beforeCategories = new Map(before.categories.map((category) => [category.id, category]));
  for (const category of after.categories) {
    const previous = beforeCategories.get(category.id);
    if (previous && previous.name !== category.name) {
      rows.push({
        kind: "category",
        name: category.name,
        detail: `was “${previous.name}”`,
      });
    }
  }

  const beforeItems = new Map(
    before.categories.flatMap((category) => category.items).map((item) => [item.id, item])
  );
  const afterItems = new Set(
    after.categories.flatMap((category) => category.items).map((item) => item.id)
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
      const wasSoldOut = previous.available === false;
      const soldOut = item.available === false;
      if (wasSoldOut !== soldOut) {
        rows.push({
          kind: "availability",
          name: item.name,
          detail: soldOut ? "now sold out" : "available again",
        });
      }
    }
  }

  // Removals last: gone dishes are the ones an owner double-checks.
  for (const [id, item] of beforeItems) {
    if (!afterItems.has(id)) rows.push({ kind: "removed", name: item.name, detail: null });
  }

  const counts = emptyCounts();
  for (const row of rows) counts[row.kind] += 1;
  return { rows, counts };
}

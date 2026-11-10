import { describe, expect, it } from "vitest";

import {
  menuCategorySchema,
  menuDocumentSchema,
  menuItemSchema,
  SCHEMA_VERSION,
  type MenuCategory,
  type MenuDocument,
  type MenuItem,
  type MenuItemImage,
} from "@/features/menu/schema";
import { summarizeMenuChanges } from "@/features/publishing/changes";

/**
 * "Since you last published" — the diff the publish panel shows.
 *
 * The properties that make it trustworthy: items are matched by id (a rename
 * is a rename, a moved dish is not churn), every pricing change is reported
 * including size variants, and an unchanged menu reports nothing.
 */

function item(id: string, name: string, price: number | null, extra: Partial<MenuItem> = {}) {
  return menuItemSchema.parse({
    id,
    name,
    description: null,
    price,
    currency: null,
    sortOrder: 0,
    available: null,
    variants: [],
    dietaryLabels: [],
    options: [],
    reviewNotes: [],
    ...extra,
  });
}

function category(id: string, name: string, items: MenuItem[]): MenuCategory {
  return menuCategorySchema.parse({ id, name, sortOrder: 0, items });
}

function doc(categories: MenuCategory[], overrides: Partial<MenuDocument> = {}): MenuDocument {
  return menuDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc-1",
    title: "Main Menu",
    currency: "USD",
    categories,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("summarizeMenuChanges", () => {
  it("reports nothing for an identical menu", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const summary = summarizeMenuChanges(before, before);
    expect(summary.rows).toEqual([]);
    expect(summary.counts.added).toBe(0);
    expect(summary.counts.repriced).toBe(0);
  });

  it("lists added, removed, renamed and repriced dishes by id", () => {
    const before = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", 4.5),
        item("i2", "Mocha", 5),
        item("i3", "Tea", 3),
      ]),
    ]);
    const after = doc([
      category("c1", "Drinks", [
        item("i1", "Oat Latte", 4.5),
        item("i2", "Mocha", 5.5),
        item("i4", "Flat White", 4.25),
      ]),
    ]);

    const summary = summarizeMenuChanges(before, after);
    expect(summary.counts).toEqual({
      title: 0,
      currency: 0,
      category: 0,
      added: 1,
      removed: 1,
      renamed: 1,
      repriced: 1,
      photo: 0,
      availability: 0,
      description: 0,
      labels: 0,
      options: 0,
      moved: 0,
    });
    expect(summary.rows).toEqual([
      { kind: "renamed", name: "Oat Latte", detail: "was “Latte”" },
      { kind: "repriced", name: "Mocha", detail: "USD 5.00 → USD 5.50" },
      { kind: "added", name: "Flat White", detail: "USD 4.25" },
      { kind: "removed", name: "Tea", detail: null },
    ]);
  });

  it("reports a dish moved to another section as one move, not churn", () => {
    const before = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5)]),
      category("c2", "Food", []),
    ]);
    const after = doc([
      category("c1", "Drinks", []),
      category("c2", "Food", [item("i1", "Latte", 4.5)]),
    ]);
    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([{ kind: "moved", name: "Latte", detail: "moved to Food" }]);
    expect(summary.counts.moved).toBe(1);
    expect(summary.counts.removed).toBe(0);
    expect(summary.counts.added).toBe(0);
  });

  it("reports description edits without quoting them", () => {
    const bare = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const described = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5, { description: "Oat milk" })]),
    ]);
    const reworded = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5, { description: "House oat milk" })]),
    ]);
    const blanked = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5, { description: "   " })]),
    ]);

    expect(summarizeMenuChanges(bare, described).rows).toEqual([
      { kind: "description", name: "Latte", detail: "added" },
    ]);
    expect(summarizeMenuChanges(described, reworded).rows).toEqual([
      { kind: "description", name: "Latte", detail: "updated" },
    ]);
    expect(summarizeMenuChanges(described, blanked).rows).toEqual([
      { kind: "description", name: "Latte", detail: "removed" },
    ]);
    expect(summarizeMenuChanges(bare, bare).counts.description).toBe(0);
  });

  it("reports option-group edits on the dish they belong to", () => {
    const before = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", 4.5, {
          options: [
            {
              name: "Milk",
              required: false,
              selection: "one",
              min: 0,
              max: null,
              allowDuplicates: false,
              choices: [{ name: "Oat", priceDelta: 0 }],
            },
          ],
        }),
      ]),
    ]);
    const after = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", 4.5, {
          options: [
            {
              name: "Milk",
              required: true,
              selection: "one",
              min: 0,
              max: null,
              allowDuplicates: false,
              choices: [
                { name: "Oat", priceDelta: 0.5 },
                { name: "Soy", priceDelta: 0 },
              ],
            },
            {
              name: "Shots",
              required: false,
              selection: "many",
              min: 0,
              max: 2,
              allowDuplicates: false,
              choices: [{ name: "Extra", priceDelta: 1 }],
            },
          ],
        }),
      ]),
    ]);

    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([
      {
        kind: "options",
        name: "Latte",
        detail: "Milk now required · Oat +0.00 → +0.50 · Soy added to Milk · Shots added",
      },
    ]);
    expect(summary.counts.options).toBe(1);
  });

  it("reports dietary label changes on the dish they belong to", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const after = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", 4.5, { dietaryLabels: ["vegan", "gluten-free"] }),
      ]),
    ]);

    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([
      { kind: "labels", name: "Latte", detail: "none → vegan, gluten-free" },
    ]);
    expect(summary.counts.labels).toBe(1);
  });

  it("aggregates a reorder into one row per section", () => {
    const before = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", 4.5),
        item("i2", "Mocha", 5),
        item("i3", "Tea", 3),
      ]),
    ]);
    const after = doc([
      category("c1", "Drinks", [
        item("i3", "Tea", 3),
        item("i1", "Latte", 4.5),
        item("i2", "Mocha", 5),
      ]),
    ]);

    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([{ kind: "moved", name: "Drinks", detail: "3 dishes reordered" }]);
    expect(summary.counts.moved).toBe(1);
  });

  it("does not read a new dish inserted mid-list as a reorder", () => {
    const before = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5), item("i2", "Mocha", 5)]),
    ]);
    const after = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", 4.5),
        item("i3", "Tea", 3),
        item("i2", "Mocha", 5),
      ]),
    ]);

    expect(summarizeMenuChanges(before, after).rows).toEqual([
      { kind: "added", name: "Tea", detail: "USD 3.00" },
    ]);
  });

  it("reports an empty section appearing or disappearing", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const withEmpty = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5)]),
      category("c2", "Sunset specials", []),
    ]);

    expect(summarizeMenuChanges(before, withEmpty).rows).toEqual([
      { kind: "category", name: "Sunset specials", detail: "added" },
    ]);
    expect(summarizeMenuChanges(withEmpty, before).rows).toEqual([
      { kind: "category", name: "Sunset specials", detail: "removed" },
    ]);
  });

  it("does not double-count a section that arrived with its dishes", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const after = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5)]),
      category("c2", "Food", [item("i2", "Toast", 6)]),
    ]);

    expect(summarizeMenuChanges(before, after).rows).toEqual([
      { kind: "added", name: "Toast", detail: "USD 6.00" },
    ]);
  });

  it("reports size price changes and variant additions", () => {
    const before = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", null, {
          variants: [
            { name: "Small", price: 3.5 },
            { name: "Large", price: 4.5 },
          ],
        }),
      ]),
    ]);
    const after = doc([
      category("c1", "Drinks", [
        item("i1", "Latte", null, {
          variants: [
            { name: "Small", price: 4 },
            { name: "Large", price: 4.5 },
            { name: "Mega", price: 5.5 },
          ],
        }),
      ]),
    ]);

    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([
      {
        kind: "repriced",
        name: "Latte",
        detail: "Small USD 3.50 → USD 4.00 · Mega added",
      },
    ]);
  });

  it("shows a missing price honestly instead of inventing one", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Market Juice", null)])]);
    const after = doc([category("c1", "Drinks", [item("i1", "Market Juice", 6)])]);
    expect(summarizeMenuChanges(before, after).rows).toEqual([
      { kind: "repriced", name: "Market Juice", detail: "— → USD 6.00" },
    ]);
  });

  it("reports sold-out flips, section renames, and a menu title change", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const after = doc(
      [category("c1", "Café drinks", [item("i1", "Latte", 4.5, { available: false })])],
      {
        title: "Lunch Menu",
      }
    );

    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([
      { kind: "title", name: "Lunch Menu", detail: "“Main Menu” → “Lunch Menu”" },
      { kind: "category", name: "Café drinks", detail: "was “Drinks”" },
      { kind: "availability", name: "Latte", detail: "now sold out" },
    ]);
  });

  it("reports a dish photo being added, replaced, or removed", () => {
    function photo(key: string): MenuItemImage {
      return {
        url: `https://abc123.ufs.sh/f/${key}`,
        key,
        width: 1024,
        height: 768,
        thumb: null,
      };
    }
    const bare = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const added = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5, { image: photo("a") })]),
    ]);
    const replaced = doc([
      category("c1", "Drinks", [item("i1", "Latte", 4.5, { image: photo("b") })]),
    ]);

    expect(summarizeMenuChanges(bare, added).rows).toEqual([
      { kind: "photo", name: "Latte", detail: "added" },
    ]);
    expect(summarizeMenuChanges(added, replaced).rows).toEqual([
      { kind: "photo", name: "Latte", detail: "replaced" },
    ]);
    expect(summarizeMenuChanges(replaced, bare).rows).toEqual([
      { kind: "photo", name: "Latte", detail: "removed" },
    ]);
    expect(summarizeMenuChanges(bare, bare).counts.photo).toBe(0);
  });

  it("stops comparing prices when the currency itself changed", () => {
    const before = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])]);
    const after = doc([category("c1", "Drinks", [item("i1", "Latte", 4.5)])], {
      currency: "EUR",
    });

    const summary = summarizeMenuChanges(before, after);
    expect(summary.rows).toEqual([{ kind: "currency", name: "Currency", detail: "USD → EUR" }]);
    expect(summary.counts.repriced).toBe(0);
  });
});

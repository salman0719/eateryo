import { describe, expect, it } from "vitest";

import {
  menuDocumentSchema,
  menuItemSchema,
  SCHEMA_VERSION,
  type MenuDocument,
  type MenuItem,
  type MenuItemImage,
} from "@/features/menu/schema";
import { duplicateItem, setItemImage } from "@/features/menu/menu-utils";
import { itemImageCopy, itemImageKey } from "@/features/item-images/ref";

/**
 * Dish photos on the canonical menu document.
 *
 * The properties that matter: a document saved before photos existed still
 * validates (the field is optional), a stored reference is always an https
 * CDN address we are willing to render, and the reading helpers prefer the
 * small copy without inventing one.
 */

const IMAGE: MenuItemImage = {
  url: "https://abc123.ufs.sh/f/display-key",
  key: "display-key",
  width: 1024,
  height: 768,
  thumb: {
    url: "https://abc123.ufs.sh/f/thumb-key",
    key: "thumb-key",
    width: 256,
    height: 192,
  },
};

function item(id: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return menuItemSchema.parse({
    id,
    name: "Latte",
    description: null,
    price: 4.5,
    currency: null,
    sortOrder: 0,
    available: null,
    dietaryLabels: [],
    variants: [],
    options: [],
    reviewNotes: [],
    ...overrides,
  });
}

function doc(items: MenuItem[]): MenuDocument {
  return menuDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc-1",
    title: "Main Menu",
    currency: "USD",
    categories: [{ id: "c1", name: "Drinks", sortOrder: 0, items }],
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
}

describe("menu item photos", () => {
  it("round-trips a photo reference through the schema", () => {
    const parsed = doc([item("i1", { image: IMAGE })]);
    const image = parsed.categories[0].items[0].image;

    expect(image).toEqual(IMAGE);
    expect(itemImageCopy(image)).toEqual({
      url: "https://abc123.ufs.sh/f/thumb-key",
      width: 256,
      height: 192,
    });
  });

  it("defaults a missing thumbnail to null", () => {
    const parsed = item("i1", {
      image: { url: IMAGE.url, key: IMAGE.key, width: 1024, height: 768, thumb: null },
    });
    expect(parsed.image?.thumb).toBeNull();
    expect(itemImageCopy(parsed.image)).toEqual({
      url: "https://abc123.ufs.sh/f/display-key",
      width: 1024,
      height: 768,
    });
  });

  it("still validates items and documents saved before dish photos existed", () => {
    const parsed = doc([item("i1")]);
    expect(parsed.categories[0].items[0].image).toBeUndefined();
    expect(itemImageCopy(undefined)).toBeNull();
    expect(itemImageKey(undefined)).toBeNull();
  });

  it("refuses a photo address that is not absolute https", () => {
    for (const url of ["http://abc123.ufs.sh/f/key", "/local/photo.jpg", "javascript:alert(1)"]) {
      expect(() =>
        item("i1", { image: { url, key: "key", width: 100, height: 100, thumb: null } })
      ).toThrow();
    }
  });

  it("attaches, replaces and removes a photo without touching the file", () => {
    const start = doc([item("i1")]);
    const attached = setItemImage(start, "c1", "i1", IMAGE);
    expect(attached.categories[0].items[0].image).toEqual(IMAGE);
    expect(attached.updatedAt).not.toBe(start.updatedAt);

    const replacement: MenuItemImage = {
      url: "https://abc123.ufs.sh/f/other-key",
      key: "other-key",
      width: 1024,
      height: 1024,
      thumb: null,
    };
    const replaced = setItemImage(attached, "c1", "i1", replacement);
    expect(replaced.categories[0].items[0].image).toEqual(replacement);

    const removed = setItemImage(replaced, "c1", "i1", null);
    expect(removed.categories[0].items[0].image).toBeUndefined();
    // Removing a reference is not a deletion: the previous snapshot keeps its
    // own copy, and the document simply stops pointing at the file.
    expect(itemImageKey(removed.categories[0].items[0].image)).toBeNull();
  });

  it("keeps the same stored copy when an item is duplicated", () => {
    const duplicated = duplicateItem(doc([item("i1", { image: IMAGE })]), "c1", "i1");
    const [original, copy] = duplicated.categories[0].items;

    expect(copy.id).not.toBe(original.id);
    expect(copy.image).toEqual(IMAGE);
  });
});

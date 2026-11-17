import { describe, expect, it } from "vitest";

import { menuDocumentSchema } from "../src/features/menu/schema";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";

describe("menuDocumentSchema", () => {
  it("accepts the sample menu fixture", () => {
    const parsed = menuDocumentSchema.parse(createSampleMenuDocument());
    expect(parsed.categories).toHaveLength(2);
    // The fixture mirrors a real extraction: the photo names the café, so the
    // menu itself is the main one and the café name is kept as provenance.
    expect(parsed.title).toBe("Main Menu");
    expect(parsed.source?.originalTitle).toBe("Sunny Side Café");
  });

  it("fills collection defaults for a minimal document", () => {
    const parsed = menuDocumentSchema.parse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Minimal",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [{ id: "c1", name: "Drinks", sortOrder: 0 }],
    });
    expect(parsed.categories[0].items).toEqual([]);
    expect(parsed.categories[0].items).toEqual([]);
  });

  it("accepts honest nulls for unknown values", () => {
    const parsed = menuDocumentSchema.parse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Sparse",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "c1",
          name: "Mains",
          sortOrder: 0,
          items: [
            {
              id: "i1",
              name: "Mystery dish",
              description: null,
              price: null,
              currency: null,
              sortOrder: 0,
              available: null,
            },
          ],
        },
      ],
    });
    const item = parsed.categories[0].items[0];
    expect(item.price).toBeNull();
    expect(item.available).toBeNull();
    expect(item.unpricedAccepted).toBe(false);
    expect(item.dietaryLabels).toEqual([]);
    expect(item.reviewNotes).toEqual([]);
  });

  it("fills category and label defaults for pre-redesign documents", () => {
    // Documents saved before descriptions/covers/label-meanings existed
    // carry none of the keys; they must still parse, with honest empties.
    const parsed = menuDocumentSchema.parse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Legacy",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [{ id: "c1", name: "Mains", sortOrder: 0, items: [] }],
    });
    expect(parsed.categories[0].description).toBe("");
    expect(parsed.categories[0].cover).toBeNull();
    expect(parsed.labelMeanings).toEqual({});
  });

  it("round-trips category descriptions, covers, and custom label meanings", () => {
    const cover = {
      url: "https://cdn.example/dish.jpg",
      key: "dish-key",
      width: 1024,
      height: 768,
      thumb: null,
    };
    const parsed = menuDocumentSchema.parse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Covered",
      currency: "€",
      labelMeanings: { SF: "Contains sesame" },
      updatedAt: new Date().toISOString(),
      categories: [
        { id: "c1", name: "Starters", sortOrder: 0, description: "To open", cover, items: [] },
      ],
    });
    expect(parsed.categories[0].description).toBe("To open");
    expect(parsed.categories[0].cover).toEqual(cover);
    expect(parsed.labelMeanings).toEqual({ SF: "Contains sesame" });
    // A re-save parses identically: the new fields are stable.
    expect(menuDocumentSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects non-https category covers like dish photos", () => {
    const result = menuDocumentSchema.safeParse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Bad cover",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "c1",
          name: "Mains",
          sortOrder: 0,
          description: "",
          cover: { url: "http://cdn.example/dish.jpg", key: "k", width: 10, height: 10 },
          items: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invented-looking wrong types instead of coercing them", () => {
    const result = menuDocumentSchema.safeParse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Bad",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "c1",
          name: "Drinks",
          sortOrder: 0,
          items: [
            {
              id: "i1",
              // Price must be numeric or null — a string like "$12.50"
              // has to be parsed by the caller, not the schema.
              name: "Latte",
              description: null,
              price: "$12.50",
              currency: null,
              sortOrder: 0,
              available: null,
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty names and wrong schema versions", () => {
    const emptyName = menuDocumentSchema.safeParse({
      schemaVersion: 1,
      id: "menu-1",
      title: "",
      currency: null,
      updatedAt: new Date().toISOString(),
    });
    expect(emptyName.success).toBe(false);

    const wrongVersion = menuDocumentSchema.safeParse({
      schemaVersion: 2,
      id: "menu-1",
      title: "Future",
      currency: null,
      updatedAt: new Date().toISOString(),
    });
    expect(wrongVersion.success).toBe(false);
  });
});

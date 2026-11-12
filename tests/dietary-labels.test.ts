import { describe, expect, it } from "vitest";

import {
  STARTER_DIETARY_LABELS,
  dedupeDietaryLabels,
  dietaryLabelVocabulary,
  sameDietaryLabels,
  suggestDietaryLabels,
  type DietaryLabelSource,
} from "@/features/menu/dietary-labels";

/**
 * 010 — labels are already `string[]` everywhere (schema, extraction, CSV).
 * What the editor needs is a way to say "this is one label" and a list of the
 * labels the menu already uses, derived from documents already in memory: no
 * new storage, no endpoint, no claim the menu never showed.
 */

function source(...items: string[][]): DietaryLabelSource {
  return { categories: [{ items: items.map((dietaryLabels) => ({ dietaryLabels })) }] };
}

describe("dedupeDietaryLabels", () => {
  it("trims, drops empties and keeps the first spelling of a diet", () => {
    expect(
      dedupeDietaryLabels([" Vegan ", "vegan", "", "  ", "GLUTEN-FREE", "gluten-free"])
    ).toEqual(["Vegan", "GLUTEN-FREE"]);
  });

  it("keeps a label containing a comma whole — the defect the comma string caused", () => {
    const committed = dedupeDietaryLabels(["vegan, dairy-free"]);
    expect(committed).toEqual(["vegan, dairy-free"]);
    // A save/reload round trip must not cut it in two.
    expect(dedupeDietaryLabels([...committed])).toEqual(["vegan, dairy-free"]);
  });

  it("collapses inner whitespace so two typings of one label agree", () => {
    expect(dedupeDietaryLabels(["gluten   free", "gluten free"])).toEqual(["gluten free"]);
  });
});

describe("sameDietaryLabels", () => {
  it("compares order-sensitively", () => {
    expect(sameDietaryLabels(["vegan"], ["vegan"])).toBe(true);
    expect(sameDietaryLabels(["vegan", "halal"], ["halal", "vegan"])).toBe(false);
    expect(sameDietaryLabels([], [])).toBe(true);
  });
});

describe("dietaryLabelVocabulary", () => {
  it("ranks labels by use across the document, most-used first", () => {
    const vocabulary = dietaryLabelVocabulary([
      source(["vegan"], ["vegan", "gluten-free"]),
      source(["vegetarian"]),
    ]);
    expect(vocabulary[0]).toBe("vegan");
    expect(new Set(vocabulary.slice(0, 3))).toEqual(
      new Set(["vegan", "gluten-free", "vegetarian"])
    );
  });

  it("adds the starter vocabulary for a menu that has none, never duplicating a used label", () => {
    const fresh = dietaryLabelVocabulary([]);
    expect(fresh).toHaveLength(STARTER_DIETARY_LABELS.length);
    expect(fresh).toContain("vegan");

    const used = dietaryLabelVocabulary([source(["vegetarian"])]);
    expect(used.filter((label) => label.toLowerCase() === "vegetarian")).toHaveLength(1);
    expect(used[0]).toBe("vegetarian");
    expect(used).toHaveLength(STARTER_DIETARY_LABELS.length);
  });
});

describe("suggestDietaryLabels", () => {
  const vocabulary = ["vegan", "vegetarian", "gluten-free", "dairy-free"];

  it("never offers a label the item already carries", () => {
    expect(suggestDietaryLabels(vocabulary, { exclude: ["VEGAN"] })).toEqual([
      "vegetarian",
      "gluten-free",
      "dairy-free",
    ]);
  });

  it("filters on the draft and puts prefix matches first", () => {
    expect(suggestDietaryLabels(vocabulary, { query: "veg" })).toEqual(["vegan", "vegetarian"]);
    expect(suggestDietaryLabels(["gluten-free", "free-range"], { query: "free" })).toEqual([
      "free-range",
      "gluten-free",
    ]);
  });

  it("caps the row", () => {
    expect(suggestDietaryLabels(vocabulary, { query: "free", limit: 1 })).toEqual(["gluten-free"]);
    expect(suggestDietaryLabels(vocabulary, { limit: 2 })).toEqual(["vegan", "vegetarian"]);
  });
});

import { describe, expect, it } from "vitest";

import {
  DIETARY_LABEL_MEANINGS,
  STARTER_DIETARY_LABELS,
  dedupeDietaryLabels,
  dietaryLabelMeaning,
  dietaryLabelUsage,
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

describe("dietaryLabelUsage", () => {
  it("counts usage, ranks most-used first, and keeps unused starters at zero", () => {
    const usage = dietaryLabelUsage([
      source(["vegan"], ["vegan", "gluten-free"]),
      source(["low-alcohol"]),
    ]);
    expect(usage[0]).toEqual({ label: "vegan", count: 2 });
    expect(usage.find((entry) => entry.label === "gluten-free")).toEqual({
      label: "gluten-free",
      count: 1,
    });
    expect(usage.find((entry) => entry.label === "low-alcohol")).toEqual({
      label: "low-alcohol",
      count: 1,
    });
    expect(usage.find((entry) => entry.label === "halal")).toEqual({ label: "halal", count: 0 });
    // The vocabulary is the same list, labels only.
    const docs = [source(["vegan"], ["vegan", "gluten-free"]), source(["low-alcohol"])];
    expect(dietaryLabelVocabulary(docs)).toEqual(dietaryLabelUsage(docs).map((e) => e.label));
  });
});

describe("dietaryLabelMeaning", () => {
  it("explains every starter code from the built-in dictionary", () => {
    for (const code of STARTER_DIETARY_LABELS) {
      expect(DIETARY_LABEL_MEANINGS[code]).toMatch(/\S/);
      expect(dietaryLabelMeaning({}, code)).toBe(DIETARY_LABEL_MEANINGS[code]);
    }
    expect(dietaryLabelMeaning({}, "nut-free")).toBe("No peanuts or tree nuts — ask about prep.");
  });

  it("prefers the menu's own meaning and never invents one", () => {
    const sourceDoc = { labelMeanings: { "low-alcohol": "Under 1.2% ABV." } };
    expect(dietaryLabelMeaning(sourceDoc, "low-alcohol")).toBe("Under 1.2% ABV.");
    expect(dietaryLabelMeaning(sourceDoc, "LOW-alcohol")).toBe("Under 1.2% ABV.");
    expect(dietaryLabelMeaning(sourceDoc, "mystery-meat")).toBeNull();
    expect(dietaryLabelMeaning(sourceDoc, "   ")).toBeNull();
  });
});

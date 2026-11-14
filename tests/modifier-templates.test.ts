import { describe, expect, it } from "vitest";

import { createMenuDocument, addCategory, addItem } from "@/features/menu/menu-utils";
import {
  addModifierTemplate,
  allDishes,
  applyModifierTemplate,
  deleteModifierTemplate,
  dishesMissingTemplate,
  modifierTemplateUsage,
  refreshDishesFromTemplate,
  updateModifierTemplate,
} from "@/features/menu/modifier-templates";
import type { MenuDocument } from "@/features/menu/schema";

/**
 * Shared modifier templates: library CRUD, copy-on-apply, and explicit
 * refresh. Dish copies are snapshots — nothing propagates automatically.
 */

const SAUCES = {
  name: "Sauces",
  min: 0,
  max: 1,
  choices: [
    { name: "Marinara", priceDelta: 0 },
    { name: "Pesto", priceDelta: 1.5 },
  ],
} as const;

function docWithPizzas(): MenuDocument {
  let doc = createMenuDocument({ title: "Main Menu" });
  doc = addCategory(doc, { name: "Pizzas" });
  const pizzas = doc.categories[0].id;
  doc = addItem(doc, pizzas, { name: "Margherita" });
  doc = addItem(doc, pizzas, { name: "Diavola" });
  doc = addCategory(doc, { name: "Drinks" });
  const drinks = doc.categories[1].id;
  doc = addItem(doc, drinks, { name: "Cola" });
  return addModifierTemplate(doc, structuredClone(SAUCES));
}

describe("modifier template library", () => {
  it("starts empty and stays valid for old documents", () => {
    expect(createMenuDocument().modifierTemplates).toEqual([]);
  });

  it("adds a template with contract defaults for partial shapes", () => {
    const doc = addModifierTemplate(createMenuDocument(), {
      name: "Toppings",
      choices: [{ name: "Basil", priceDelta: null }],
    });
    expect(doc.modifierTemplates).toHaveLength(1);
    expect(doc.modifierTemplates[0]).toMatchObject({
      name: "Toppings",
      min: 0,
      max: null,
    });
  });

  it("rejects empty and duplicate template names", () => {
    const doc = addModifierTemplate(createMenuDocument(), SAUCES);
    expect(() => addModifierTemplate(doc, { ...SAUCES, name: "  " })).toThrow();
    expect(() => addModifierTemplate(doc, SAUCES)).toThrow(/already exists/);
  });

  it("edits a template without touching dish copies", () => {
    let doc = docWithPizzas();
    const target = allDishes(doc)[0];
    doc = applyModifierTemplate(doc, "Sauces", [target.itemId]);
    doc = updateModifierTemplate(doc, "Sauces", { min: 1 });
    expect(doc.modifierTemplates[0].min).toBe(1);
    const dish = doc.categories[0].items[0];
    expect(dish.options[0].min).toBe(0);
  });

  it("rejects renames that collide and unknown names", () => {
    let doc = docWithPizzas();
    doc = addModifierTemplate(doc, { name: "Toppings", choices: [] });
    expect(() => updateModifierTemplate(doc, "Sauces", { name: "Toppings" })).toThrow(
      /already exists/
    );
    expect(() => updateModifierTemplate(doc, "Missing", {})).toThrow(/Unknown add-on set/);
  });

  it("deletes a template but leaves dish copies in place", () => {
    let doc = docWithPizzas();
    const target = allDishes(doc)[0];
    doc = applyModifierTemplate(doc, "Sauces", [target.itemId]);
    doc = deleteModifierTemplate(doc, "Sauces");
    expect(doc.modifierTemplates).toEqual([]);
    expect(doc.categories[0].items[0].options.map((group) => group.name)).toEqual(["Sauces"]);
  });

  it("throws for unknown template names", () => {
    const doc = createMenuDocument();
    expect(() => deleteModifierTemplate(doc, "Missing")).toThrow(/Unknown add-on set/);
    expect(() => modifierTemplateUsage(doc, "Missing")).toThrow(/Unknown add-on set/);
    expect(() => applyModifierTemplate(doc, "Missing", ["i1"])).toThrow(/Unknown add-on set/);
  });
});

describe("apply and refresh", () => {
  it("copies the group onto chosen dishes and reports usage", () => {
    let doc = docWithPizzas();
    const dishes = allDishes(doc);
    const pizzas = dishes.filter((dish) => dish.categoryName === "Pizzas");
    doc = applyModifierTemplate(
      doc,
      "Sauces",
      pizzas.map((dish) => dish.itemId)
    );
    for (const dish of pizzas) {
      const item = doc.categories[0].items.find((candidate) => candidate.id === dish.itemId);
      expect(item?.options.map((group) => group.name)).toEqual(["Sauces"]);
    }
    expect(doc.categories[1].items[0].options).toEqual([]);
    expect(modifierTemplateUsage(doc, "Sauces").map((ref) => ref.itemName)).toEqual([
      "Margherita",
      "Diavola",
    ]);
    expect(dishesMissingTemplate(doc, "Sauces").map((ref) => ref.itemName)).toEqual(["Cola"]);
  });

  it("re-applying a template replaces the dish's copy (upsert by name)", () => {
    let doc = docWithPizzas();
    const target = allDishes(doc)[0].itemId;
    doc = applyModifierTemplate(doc, "Sauces", [target]);
    doc = updateModifierTemplate(doc, "Sauces", { min: 1 });
    doc = applyModifierTemplate(doc, "Sauces", [target]);
    const item = doc.categories[0].items[0];
    expect(item.options).toHaveLength(1);
    expect(item.options[0].min).toBe(1);
  });

  it("refresh pushes the definition to every dish carrying the group", () => {
    let doc = docWithPizzas();
    const dishes = allDishes(doc);
    doc = applyModifierTemplate(
      doc,
      "Sauces",
      dishes.map((dish) => dish.itemId)
    );
    doc = updateModifierTemplate(doc, "Sauces", {
      choices: [
        ...SAUCES.choices.map((choice) => ({ ...choice })),
        { name: "Alfredo", priceDelta: 2 },
      ],
    });
    const { doc: refreshed, updatedCount } = refreshDishesFromTemplate(doc, "Sauces");
    expect(updatedCount).toBe(3);
    for (const category of refreshed.categories) {
      for (const item of category.items) {
        expect(item.options[0].choices.map((choice) => choice.name)).toEqual([
          "Marinara",
          "Pesto",
          "Alfredo",
        ]);
      }
    }
  });

  it("refresh leaves dishes without the group alone", () => {
    let doc = docWithPizzas();
    const target = allDishes(doc)[0].itemId;
    doc = applyModifierTemplate(doc, "Sauces", [target]);
    const { doc: refreshed, updatedCount } = refreshDishesFromTemplate(doc, "Sauces");
    expect(updatedCount).toBe(1);
    expect(refreshed.categories[0].items[1].options).toEqual([]);
    expect(refreshed.categories[1].items[0].options).toEqual([]);
  });

  it("apply with no selection returns the document unchanged", () => {
    const doc = docWithPizzas();
    expect(applyModifierTemplate(doc, "Sauces", [])).toBe(doc);
  });

  it("apply throws for unknown item ids", () => {
    const doc = docWithPizzas();
    expect(() => applyModifierTemplate(doc, "Sauces", ["nope"])).toThrow(/Unknown item id/);
  });
});

import { describe, expect, it } from "vitest";

import {
  menuItemSchema,
  menuOptionSchema,
  SCHEMA_VERSION,
  type MenuItem,
  type MenuOption,
} from "@/features/menu/schema";
import {
  formatSelectionsSummary,
  normalizeSelections,
  optionsPriceDelta,
  priceWithOptions,
  selectionsKey,
  validateOptionSelections,
} from "@/features/menu/option-groups";
import { addLine } from "@/features/orders/schema";

/**
 * P1 option groups: the contract (required / one-vs-many / min-max /
 * duplicates) and the pure helpers every surface shares.
 */

function item(extra: Partial<MenuItem> = {}): MenuItem {
  return menuItemSchema.parse({
    id: "i1",
    name: "Burger",
    description: null,
    price: 10,
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

/** Old/partial group shapes gain the contract defaults on parse. */
function group(input: unknown): MenuOption {
  return menuOptionSchema.parse(input);
}

describe("menu option contract", () => {
  it("defaults old documents to optional single-pick groups", () => {
    const parsed = item({
      options: [group({ name: "Sauce", choices: [{ name: "Mayo", priceDelta: 0 }] })],
    });
    expect(parsed.options).toEqual([
      {
        name: "Sauce",
        required: false,
        selection: "one",
        min: 0,
        max: null,
        allowDuplicates: false,
        choices: [{ name: "Mayo", priceDelta: 0 }],
      },
    ]);
  });

  it("keeps documents without options valid", () => {
    expect(() => item()).not.toThrow();
  });
});

describe("validateOptionSelections", () => {
  const dish = item({
    options: [
      group({
        name: "Sauce",
        required: true,
        choices: [
          { name: "Mayo", priceDelta: 0 },
          { name: "BBQ", priceDelta: 0.5 },
        ],
      }),
      group({
        name: "Toppings",
        selection: "many",
        max: 2,
        choices: [
          { name: "Bacon", priceDelta: 1.5 },
          { name: "Cheese", priceDelta: 1 },
          { name: "Onions", priceDelta: 0 },
        ],
      }),
    ],
  });

  it("accepts a satisfied required group and skips the optional one", () => {
    expect(
      validateOptionSelections(dish, [{ groupName: "Sauce", choiceName: "Mayo" }])
    ).toBeNull();
  });

  it("refuses a missing required group", () => {
    expect(validateOptionSelections(dish, [])).toMatch(/Sauce/);
  });

  it("refuses an unknown group or choice", () => {
    expect(
      validateOptionSelections(dish, [{ groupName: "Drink", choiceName: "Cola" }])
    ).toMatch(/not an option/);
    expect(
      validateOptionSelections(dish, [{ groupName: "Sauce", choiceName: "Ranch" }])
    ).toMatch(/not on the menu/);
  });

  it("refuses two picks in a single-pick group", () => {
    expect(
      validateOptionSelections(dish, [
        { groupName: "Sauce", choiceName: "Mayo" },
        { groupName: "Sauce", choiceName: "BBQ" },
      ])
    ).toMatch(/only one/);
  });

  it("enforces max and duplicate rules on multi-pick groups", () => {
    const sauce = { groupName: "Sauce", choiceName: "Mayo" };
    expect(
      validateOptionSelections(dish, [
        sauce,
        { groupName: "Toppings", choiceName: "Bacon" },
        { groupName: "Toppings", choiceName: "Cheese" },
        { groupName: "Toppings", choiceName: "Onions" },
      ])
    ).toMatch(/at most 2/);
    expect(
      validateOptionSelections(dish, [
        sauce,
        { groupName: "Toppings", choiceName: "Bacon" },
        { groupName: "Toppings", choiceName: "Bacon" },
      ])
    ).toMatch(/once/);
  });

  it("treats tap order as irrelevant", () => {
    const picks = [
      { groupName: "Toppings", choiceName: "Cheese" },
      { groupName: "Sauce", choiceName: "BBQ" },
      { groupName: "Toppings", choiceName: "Bacon" },
    ];
    expect(validateOptionSelections(dish, picks)).toBeNull();
    expect(validateOptionSelections(dish, [...picks].reverse())).toBeNull();
  });
});

describe("pricing helpers", () => {
  const dish = item({
    options: [
      group({
        name: "Extras",
        selection: "many",
        allowDuplicates: true,
        choices: [
          { name: "Bacon", priceDelta: 1.5 },
          { name: "Mystery", priceDelta: null },
        ],
      }),
    ],
  });

  it("sums deltas onto the base price", () => {
    expect(
      optionsPriceDelta(dish, [{ groupName: "Extras", choiceName: "Bacon" }])
    ).toBe(1.5);
    expect(priceWithOptions(10, dish, [{ groupName: "Extras", choiceName: "Bacon" }])).toBe(
      11.5
    );
  });

  it("stays null when the base price or any delta is unknown", () => {
    expect(priceWithOptions(null, dish, [])).toBeNull();
    expect(
      priceWithOptions(10, dish, [{ groupName: "Extras", choiceName: "Mystery" }])
    ).toBeNull();
  });
});

describe("cart key helpers", () => {
  it("normalizes tap order so equal picks share a line", () => {
    const a = [
      { groupName: "Toppings", choiceName: "Cheese" },
      { groupName: "Sauce", choiceName: "BBQ" },
    ];
    const b = [...a].reverse();
    expect(normalizeSelections(a)).toEqual(normalizeSelections(b));
    expect(selectionsKey(a)).toBe(selectionsKey(b));
    expect(selectionsKey(a)).not.toBe(selectionsKey([]));
  });

  it("summarizes picks for the cart and the kitchen", () => {
    expect(
      formatSelectionsSummary([
        { groupName: "Toppings", choiceName: "Cheese" },
        { groupName: "Sauce", choiceName: "BBQ" },
      ])
    ).toBe("BBQ, Cheese");
  });

  it("schema version is unchanged (no migration of stored docs)", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe("addLine with options", () => {
  const base = {
    menuItemId: "i1",
    name: "Burger",
    variantName: null,
    unitPrice: 11.5,
  };

  it("merges identical picks and separates different ones", () => {
    const bacon = [{ groupName: "Toppings", choiceName: "Bacon" }];
    const cheese = [{ groupName: "Toppings", choiceName: "Cheese" }];
    let cart = addLine([], { ...base, options: bacon });
    cart = addLine(cart, { ...base, options: [...bacon].reverse() });
    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(2);
    cart = addLine(cart, { ...base, options: cheese });
    expect(cart).toHaveLength(2);
  });

  it("keeps a plain line apart from a customized one", () => {
    let cart = addLine([], { ...base });
    cart = addLine(cart, {
      ...base,
      options: [{ groupName: "Toppings", choiceName: "Bacon" }],
    });
    expect(cart).toHaveLength(2);
  });
});

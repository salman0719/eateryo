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
  optionGroupConfigProblems,
  optionsPriceDelta,
  priceWithOptions,
  selectionsKey,
  validateOptionSelections,
} from "@/features/menu/option-groups";
import { addLine } from "@/features/orders/schema";

/**
 * P1 option groups: the contract (required / one-vs-many / min-max) and
 * the pure helpers every surface shares. Repeats are always rejected: the
 * picker toggles presence, so only an API client can send one.
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
  it("defaults partial groups to optional, unbounded picks", () => {
    const parsed = item({
      options: [group({ name: "Sauce", choices: [{ name: "Mayo", priceDelta: 0 }] })],
    });
    expect(parsed.options).toEqual([
      {
        name: "Sauce",
        min: 0,
        max: null,
        choices: [{ name: "Mayo", priceDelta: 0 }],
      },
    ]);
  });

  it("migrates legacy required/single-pick shapes with identical behavior", () => {
    expect(
      group({
        name: "Sauce",
        required: true,
        selection: "one",
        choices: [{ name: "Mayo", priceDelta: 0 }],
      })
    ).toEqual({
      name: "Sauce",
      min: 1,
      max: 1,
      choices: [{ name: "Mayo", priceDelta: 0 }],
    });
    expect(
      group({
        name: "Toppings",
        required: false,
        selection: "many",
        max: 2,
        choices: [{ name: "Bacon", priceDelta: 1 }],
      })
    ).toEqual({
      name: "Toppings",
      min: 0,
      max: 2,
      choices: [{ name: "Bacon", priceDelta: 1 }],
    });
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
        min: 1,
        max: 1,
        choices: [
          { name: "Mayo", priceDelta: 0 },
          { name: "BBQ", priceDelta: 0.5 },
        ],
      }),
      group({
        name: "Toppings",
        min: 0,
        max: 2,
        choices: [
          { name: "Bacon", priceDelta: 1.5 },
          { name: "Cheese", priceDelta: 1 },
          { name: "Onions", priceDelta: 0 },
        ],
      }),
    ],
  });

  it("accepts a satisfied min-1 group and skips the optional one", () => {
    expect(validateOptionSelections(dish, [{ groupName: "Sauce", choiceName: "Mayo" }])).toBeNull();
  });

  it("refuses a skipped group with min above zero", () => {
    expect(validateOptionSelections(dish, [])).toMatch(/Sauce/);
  });

  it("refuses an unknown group or choice", () => {
    expect(validateOptionSelections(dish, [{ groupName: "Drink", choiceName: "Cola" }])).toMatch(
      /not an option/
    );
    expect(validateOptionSelections(dish, [{ groupName: "Sauce", choiceName: "Ranch" }])).toMatch(
      /not on the menu/
    );
  });

  it("refuses two picks in a max-1 group", () => {
    expect(
      validateOptionSelections(dish, [
        { groupName: "Sauce", choiceName: "Mayo" },
        { groupName: "Sauce", choiceName: "BBQ" },
      ])
    ).toMatch(/at most 1/);
  });

  it("enforces max and rejects repeated picks on multi-pick groups", () => {
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

describe("configuration problems", () => {
  const ok = group({
    name: "Sauce",
    min: 1,
    max: 2,
    choices: [
      { name: "Mayo", priceDelta: 0 },
      { name: "BBQ", priceDelta: 0 },
      { name: "Ranch", priceDelta: 1 },
    ],
  });

  it("reports nothing for an orderable group", () => {
    expect(optionGroupConfigProblems(ok)).toEqual([]);
    expect(optionGroupConfigProblems({ ...ok, min: 0, max: 1 })).toEqual([]);
  });

  it("flags a min above max", () => {
    expect(optionGroupConfigProblems({ ...ok, min: 3, max: 2 })).toEqual([
      expect.stringContaining("above Max 2"),
    ]);
  });

  it("flags a min above the choice count", () => {
    expect(optionGroupConfigProblems({ ...ok, min: 4, max: null })).toEqual([
      expect.stringContaining("more choices"),
    ]);
  });
});

describe("pricing helpers", () => {
  const dish = item({
    options: [
      group({
        name: "Extras",
        min: 0,
        max: null,
        choices: [
          { name: "Bacon", priceDelta: 1.5 },
          { name: "Mystery", priceDelta: null },
        ],
      }),
    ],
  });

  it("sums deltas onto the base price", () => {
    expect(optionsPriceDelta(dish, [{ groupName: "Extras", choiceName: "Bacon" }])).toBe(1.5);
    expect(priceWithOptions(10, dish, [{ groupName: "Extras", choiceName: "Bacon" }])).toBe(11.5);
  });

  it("stays null when the base price or any delta is unknown", () => {
    expect(priceWithOptions(null, dish, [])).toBeNull();
    expect(priceWithOptions(10, dish, [{ groupName: "Extras", choiceName: "Mystery" }])).toBeNull();
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

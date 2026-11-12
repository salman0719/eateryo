import { describe, expect, it } from "vitest";

import {
  formatItemPrice,
  formatPreviewPrice,
  formatPreviewPriceList,
  formatPriceDelta,
} from "../src/features/menu/preview-utils";

describe("formatPreviewPrice", () => {
  it("renders an em dash for an unknown price instead of inventing one", () => {
    expect(formatPreviewPrice(null, "USD", "EUR")).toBe("—");
  });

  it("prefers the item currency over the menu currency", () => {
    expect(formatPreviewPrice(4.5, "GBP", "USD")).toBe("GBP 4.50");
  });

  it("falls back to the menu currency when the item has none", () => {
    expect(formatPreviewPrice(4.5, null, "USD")).toBe("USD 4.50");
  });

  it("renders a bare fixed-point amount when no currency is known", () => {
    expect(formatPreviewPrice(4.5, null, null)).toBe("4.50");
    expect(formatPreviewPrice(0, null, "USD")).toBe("USD 0.00");
  });

  it("rounds to two decimals", () => {
    expect(formatPreviewPrice(12.345, "USD", null)).toBe("USD 12.35");
  });
});

describe("formatPriceDelta", () => {
  it("formats positive deltas with a plus sign", () => {
    expect(formatPriceDelta(1.5)).toBe("+1.50");
  });

  it("formats negative deltas with a minus sign and absolute value", () => {
    expect(formatPriceDelta(-0.5)).toBe("−0.50");
  });

  it("returns an empty string for unknown deltas (nothing invented)", () => {
    expect(formatPriceDelta(null)).toBe("");
  });
});

describe("formatPreviewPriceList", () => {
  it("states the currency once and separates each size with a pipe", () => {
    expect(formatPreviewPriceList([4.5, 6, 8], "USD", null)).toBe("USD 4.50 | 6.00 | 8.00");
  });

  it("keeps an unread size's em dash in place instead of dropping it", () => {
    expect(formatPreviewPriceList([4.5, null, 8], null, "EUR")).toBe("EUR 4.50 | — | 8.00");
  });

  it("prints no currency when not a single size is priced", () => {
    expect(formatPreviewPriceList([null, null], "USD", null)).toBe("— | —");
  });

  it("matches the single-price wording for one amount", () => {
    expect(formatPreviewPriceList([4.5], null, "USD")).toBe("USD 4.50");
    expect(formatPreviewPriceList([], "USD", null)).toBe("—");
  });
});

describe("formatItemPrice", () => {
  const item = {
    price: null,
    currency: null,
    variants: [
      { name: "Small", price: 3 },
      { name: "Large", price: 5 },
    ],
  };

  it("lists every size's price for a per-size dish", () => {
    expect(formatItemPrice(item, "USD")).toBe("USD 3.00 | 5.00");
  });

  it("uses the dish's own price when its variants carry none", () => {
    expect(
      formatItemPrice(
        { price: 4.5, currency: null, variants: [{ name: "Small", price: null }] },
        "USD"
      )
    ).toBe("USD 4.50");
  });

  it("still renders one honest em dash when nothing is priced", () => {
    expect(formatItemPrice({ price: null, currency: null, variants: [] }, "USD")).toBe("—");
  });
});

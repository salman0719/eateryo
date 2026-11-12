/**
 * Pure display helpers for the customer-facing menu preview.
 *
 * The preview shows the menu as a diner would see it — no review badges, no
 * editor chrome, and never an invented value: a missing price renders as an
 * em dash (PLAN.md: never invent prices; show nulls honestly).
 */

import type { MenuItem } from "./schema";

/**
 * Format an item price, or an em dash when the price is unknown.
 * Falls back to the item currency, then the menu currency, then nothing.
 */
export function formatPreviewPrice(
  price: number | null,
  currency: string | null,
  fallbackCurrency: string | null
): string {
  if (price === null) return "—";
  const effective = currency ?? fallbackCurrency ?? "";
  return `${effective ? `${effective} ` : ""}${price.toFixed(2)}`;
}

/**
 * Format one dish's prices as `USD 4.50 | 6.00 | 8.00` — a dish priced per
 * size states the currency once, and an unread size keeps its own em dash
 * rather than closing the gap (a three-size dish must not look two-sized).
 */
export function formatPreviewPriceList(
  prices: ReadonlyArray<number | null>,
  currency: string | null,
  fallbackCurrency: string | null
): string {
  if (prices.length === 0) return "—";
  if (prices.length === 1) {
    return formatPreviewPrice(prices[0] ?? null, currency, fallbackCurrency);
  }
  const effective = currency ?? fallbackCurrency ?? "";
  const amounts = prices.map((price) => (price === null ? "—" : price.toFixed(2))).join(" | ");
  const anyPriced = prices.some((price) => price !== null);
  return anyPriced && effective ? `${effective} ${amounts}` : amounts;
}

/**
 * The price a dish shows in the editor and the preview: its own amount, or
 * every size's amount when the menu prices it per size. Variants that are all
 * unread fall back to the dish's own price rather than printing a row of
 * dashes for a price we do have.
 */
export function formatItemPrice(
  item: Pick<MenuItem, "price" | "currency" | "variants">,
  menuCurrency: string | null
): string {
  const variantPrices = item.variants.map((variant) => variant.price);
  const priced = variantPrices.length > 0 && variantPrices.some((price) => price !== null);
  return formatPreviewPriceList(priced ? variantPrices : [item.price], item.currency, menuCurrency);
}

/**
 * Format an option-choice price delta as "+1.50" / "−0.50".
 * Returns an empty string when the delta is unknown (nothing is invented).
 */
export function formatPriceDelta(delta: number | null): string {
  if (delta === null) return "";
  const sign = delta < 0 ? "−" : "+";
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}

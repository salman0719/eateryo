import type { CheckoutLineInput, CheckoutSessionRef } from "./provider";
import { MIN_CHARGE_CENTS } from "./resolver";

/**
 * Commit 3 session wiring (pure, no Stripe calls).
 *
 * The route loads the *stored* rows (order.total_cents + order_line cents —
 * never the domain decimal) and builds the Checkout body here, so the
 * direct-charge invariants are unit-testable: integer minor units, AUD
 * only, 0% fee by construction (the provider never sends the fee key).
 */

export interface StoredCheckoutLine {
  name: string;
  unitPriceCents: number | null;
  quantity: number;
}

export interface StoredCheckoutOrder {
  id: string;
  currency: string | null;
  totalCents: number | null;
  lines: StoredCheckoutLine[];
}

/** Checkout stays 30 minutes open; the webhook still moves the board. */
export const CHECKOUT_TTL_SECONDS = 30 * 60;

export function buildCheckoutLines(order: StoredCheckoutOrder): {
  lines: CheckoutLineInput[];
  error: string | null;
} {
  if (order.totalCents === null || order.totalCents === undefined) {
    return { lines: [], error: "unpriced_lines" };
  }
  const currency = order.currency?.trim().toUpperCase() ?? "";
  if (!currency) return { lines: [], error: "currency_unknown" };
  if (currency !== "AUD") return { lines: [], error: "currency_unsupported" };
  if (
    !Number.isInteger(order.totalCents) ||
    order.totalCents < MIN_CHARGE_CENTS ||
    order.lines.length === 0
  ) {
    return { lines: [], error: order.lines.length === 0 ? "empty_order" : "amount_too_small" };
  }
  const lines: CheckoutLineInput[] = [];
  for (const line of order.lines) {
    const name = line.name.trim();
    if (!name) return { lines: [], error: "invalid_line" };
    if (
      line.unitPriceCents === null ||
      !Number.isInteger(line.unitPriceCents) ||
      line.unitPriceCents < 0 ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) {
      return { lines: [], error: line.unitPriceCents === null ? "unpriced_lines" : "invalid_line" };
    }
    lines.push({ name, unitAmountCents: line.unitPriceCents, quantity: line.quantity });
  }
  const sum = lines.reduce((total, line) => total + line.unitAmountCents * line.quantity, 0);
  if (sum !== order.totalCents) return { lines: [], error: "total_mismatch" };
  return { lines, error: null };
}

/**
 * One open session is reused per order: closing Stripe's page twice must
 * not create two charges. A session is reusable while Stripe says `open`
 * and its expiry is still in the future.
 */
export function isSessionReusable(session: CheckoutSessionRef | null, nowUnix: number): boolean {
  if (!session || !session.url) return false;
  if (session.status !== "open") return false;
  if (session.expiresAt === null) return false;
  return session.expiresAt > nowUnix;
}

/** `success_url`/`cancel_url` stay same-origin table links carrying the track token. */
export function buildReturnUrls(input: {
  origin: string;
  restaurantSlug: string;
  tableLabel: string;
  trackingToken: string;
}): { successUrl: string; cancelUrl: string } {
  const base =
    `${input.origin}/r/${encodeURIComponent(input.restaurantSlug)}` +
    `/t/${encodeURIComponent(input.tableLabel)}`;
  const track = `track=${encodeURIComponent(input.trackingToken)}`;
  return {
    successUrl: `${base}?${track}&pay=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}?${track}&pay=cancelled`,
  };
}

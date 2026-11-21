/**
 * Pure checkout gate (Commit 1 prerequisite, Commit 2 surface).
 *
 * Every surface that decides "can this order take a card?" reads this —
 * the Settings card, the diner pay button, the return page — so they
 * cannot disagree, and the rule is unit-testable without Stripe.
 *
 * Money rules encoded here:
 * - No row means pay-at-the-counter; nothing nags a café that ignores us.
 * - The kitchen never waits for a card: a forced `at_venue` is a finished
 *   state, never an error that blocks the order.
 * - The stored integer cents (`order.total_cents`) are the amount, never
 *   the domain decimal; a printed symbol (`$`) or a mixed-menu null arrives
 *   as `currency: null` and falls back instead of guessing an ISO code.
 * - v1 is AU-only: only `AUD` reaches Stripe. Anything else falls back.
 */

export type PaymentMode = "online" | "at_venue";

export type PayReason =
  | "ready"
  | "no_provider"
  | "not_connected"
  | "provider_pending"
  | "provider_restricted"
  | "currency_unknown"
  | "currency_unsupported"
  | "unpriced_lines"
  | "amount_too_small"
  | "expired";

export interface CheckoutAccount {
  /** Cached verdict: active | pending | restricted | unavailable. */
  status: string | null;
  chargesEnabled: boolean;
  /** ISO 4217 the café presents in, when known. */
  currency: string | null;
}

export interface CheckoutOrder {
  /** ISO 4217 already resolved from the menu print; null when unknown. */
  currency: string | null;
  /** Stored integer cents; null when any line is unpriced. */
  totalCents: number | null;
}

/** Stripe AU card minimum: amounts below this cannot be charged. */
export const MIN_CHARGE_CENTS = 50;

/** v1 presentment list: AU cafés settle in AUD only. */
const SUPPORTED_CURRENCIES = ["AUD"] as const;

export interface CheckoutDecision {
  mode: PaymentMode;
  reason: PayReason;
}

export function resolveCheckout(input: {
  mode: PaymentMode;
  account: CheckoutAccount | null;
  order: CheckoutOrder;
}): CheckoutDecision {
  const { mode, account, order } = input;

  if (!account) {
    return { mode: "at_venue", reason: "no_provider" };
  }
  if (account.status === "pending") {
    return { mode: "at_venue", reason: "provider_pending" };
  }
  if (account.status === "restricted" || account.status === "unavailable") {
    return { mode: "at_venue", reason: "provider_restricted" };
  }
  if (account.status !== "active" || !account.chargesEnabled) {
    return { mode: "at_venue", reason: "not_connected" };
  }
  // Active and able to charge — but the café may still choose the counter.
  // `not_connected` here reads as "online not chosen", never as an error.
  if (mode === "at_venue") {
    return { mode: "at_venue", reason: "not_connected" };
  }

  if (order.totalCents === null || order.totalCents === undefined) {
    return { mode: "at_venue", reason: "unpriced_lines" };
  }
  if (!order.currency) {
    return { mode: "at_venue", reason: "currency_unknown" };
  }
  const iso = order.currency.trim().toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(iso)) {
    return { mode: "at_venue", reason: "currency_unsupported" };
  }
  if (!Number.isInteger(order.totalCents) || order.totalCents < MIN_CHARGE_CENTS) {
    return { mode: "at_venue", reason: "amount_too_small" };
  }
  return { mode: "online", reason: "ready" };
}

/** Diner-facing sentence for a forced counter fallback. */
export function fallbackCopy(reason: PayReason): string {
  switch (reason) {
    case "ready":
      return "Pay by card now.";
    case "no_provider":
    case "not_connected":
      return "Pay at the counter — cash, EFTPOS or on collection.";
    case "provider_pending":
      return "Card payment is still being set up — pay at the counter for now.";
    case "provider_restricted":
      return "Card payment needs attention — pay at the counter for now.";
    case "currency_unknown":
    case "currency_unsupported":
      return "This order can't be paid by card — pay at the counter.";
    case "unpriced_lines":
      return "One item has no price — pay at the counter and the café will sort it.";
    case "amount_too_small":
      return "This total is too small for a card — pay at the counter.";
    case "expired":
      return "This payment link expired after 30 minutes — place a new order or pay at the counter.";
  }
}

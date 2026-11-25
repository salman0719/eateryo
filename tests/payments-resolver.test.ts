import { describe, expect, it } from "vitest";

import { resolveCheckout } from "@/features/payments/resolver";

/**
 * Commit 2 gate table: every "why is there no pay button?" answer in one
 * pure function, so the card, the diner button and the return page cannot
 * disagree.
 */

const ACTIVE = { status: "active", chargesEnabled: true, currency: "AUD" };
const ORDER = { currency: "AUD", totalCents: 1350 };

describe("resolveCheckout", () => {
  it("takes no provider as pay-at-the-counter", () => {
    expect(resolveCheckout({ mode: "at_venue", account: null, order: ORDER })).toEqual({
      mode: "at_venue",
      reason: "no_provider",
    });
  });

  it("reaches online only when active, chosen, priced, AUD and above the minimum", () => {
    expect(resolveCheckout({ mode: "online", account: ACTIVE, order: ORDER })).toEqual({
      mode: "online",
      reason: "ready",
    });
  });

  it("keeps an explicit counter choice at the counter", () => {
    expect(resolveCheckout({ mode: "at_venue", account: ACTIVE, order: ORDER })).toEqual({
      mode: "at_venue",
      reason: "not_connected",
    });
  });

  it("forces pending and restricted accounts to the counter", () => {
    expect(
      resolveCheckout({
        mode: "online",
        account: { ...ACTIVE, status: "pending" },
        order: ORDER,
      })
    ).toEqual({ mode: "at_venue", reason: "provider_pending" });
    expect(
      resolveCheckout({
        mode: "online",
        account: { ...ACTIVE, status: "restricted" },
        order: ORDER,
      })
    ).toEqual({ mode: "at_venue", reason: "provider_restricted" });
  });

  it("never guesses a currency: null or symbol-only falls back", () => {
    expect(
      resolveCheckout({ mode: "online", account: ACTIVE, order: { ...ORDER, currency: null } })
    ).toEqual({ mode: "at_venue", reason: "currency_unknown" });
    expect(
      resolveCheckout({ mode: "online", account: ACTIVE, order: { ...ORDER, currency: "USD" } })
    ).toEqual({ mode: "at_venue", reason: "currency_unsupported" });
  });

  it("refuses unpriced orders and amounts below the card minimum", () => {
    expect(
      resolveCheckout({ mode: "online", account: ACTIVE, order: { ...ORDER, totalCents: null } })
    ).toEqual({ mode: "at_venue", reason: "unpriced_lines" });
    expect(
      resolveCheckout({ mode: "online", account: ACTIVE, order: { ...ORDER, totalCents: 30 } })
    ).toEqual({ mode: "at_venue", reason: "amount_too_small" });
  });
});

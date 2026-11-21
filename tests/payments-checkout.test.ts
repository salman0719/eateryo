import { describe, expect, it, vi } from "vitest";

import {
  buildCheckoutLines,
  buildReturnUrls,
  isSessionReusable,
} from "@/features/payments/checkout";
import { createCheckoutSession, retrieveCheckoutSession } from "@/features/payments/provider";

/**
 * Commit 3 slice 1: the session is built from stored integer cents (never
 * the domain decimal), carries metadata[orderId] on the café's account,
 * sets no fee key, and an open session is reused so two taps make one charge.
 */

const ORDER = {
  id: "order_1",
  currency: "AUD",
  totalCents: 1350,
  lines: [{ name: "Flat white", unitPriceCents: 450, quantity: 3 }],
};

describe("buildCheckoutLines", () => {
  it("builds integer minor-unit lines that sum to the stored total", () => {
    const built = buildCheckoutLines(ORDER);
    expect(built.error).toBeNull();
    expect(built.lines).toEqual([{ name: "Flat white", unitAmountCents: 450, quantity: 3 }]);
  });

  it("refuses unpriced, mismatched, and non-AUD orders", () => {
    expect(buildCheckoutLines({ ...ORDER, totalCents: null }).error).toBe("unpriced_lines");
    expect(buildCheckoutLines({ ...ORDER, currency: null }).error).toBe("currency_unknown");
    expect(buildCheckoutLines({ ...ORDER, currency: "$" }).error).toBe("currency_unsupported");
    expect(buildCheckoutLines({ ...ORDER, currency: "USD" }).error).toBe("currency_unsupported");
    expect(buildCheckoutLines({ ...ORDER, totalCents: 1400 }).error).toBe("total_mismatch");
    expect(buildCheckoutLines({ ...ORDER, totalCents: 30 }).error).toBe("amount_too_small");
  });
});

describe("isSessionReusable", () => {
  const now = 1_800_000_000;
  it("reuses an open session with a future expiry and a URL", () => {
    expect(
      isSessionReusable(
        {
          id: "cs_1",
          url: "https://checkout.stripe.com/c/pay/cs_1",
          status: "open",
          paymentStatus: "unpaid",
          paymentIntentId: null,
          expiresAt: now + 60,
        },
        now
      )
    ).toBe(true);
  });

  it("refuses complete, expired, or URL-less sessions", () => {
    const base = {
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
      status: "open",
      paymentStatus: "unpaid",
      paymentIntentId: null,
      expiresAt: now + 60,
    };
    expect(isSessionReusable({ ...base, status: "complete" }, now)).toBe(false);
    expect(isSessionReusable({ ...base, expiresAt: now - 1 }, now)).toBe(false);
    expect(isSessionReusable({ ...base, url: null }, now)).toBe(false);
  });
});

describe("buildReturnUrls", () => {
  it("stays same-origin and carries the track token plus session placeholder", () => {
    const urls = buildReturnUrls({
      origin: "http://localhost:3100",
      restaurantSlug: "kiosk",
      tableLabel: "3",
      trackingToken: "track_abc",
    });
    expect(urls.successUrl).toBe(
      "http://localhost:3100/r/kiosk/t/3?track=track_abc&pay=success&session_id={CHECKOUT_SESSION_ID}"
    );
    expect(urls.cancelUrl).toBe("http://localhost:3100/r/kiosk/t/3?track=track_abc&pay=cancelled");
  });
});

describe("checkout provider (direct charge)", () => {
  it("posts to the café account header with no fee key and metadata orderId", async () => {
    let seenHeaders: Record<string, string> = {};
    let seenBody = "";
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }),
        { status: 200 }
      );
    });
    const wrapped: typeof fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      seenHeaders = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([key, value]) => [
          String(key).toLowerCase(),
          String(value),
        ])
      );
      seenBody = String(init?.body ?? "");
      return fetchImpl();
    }) as typeof fetch;

    await createCheckoutSession(
      "sk_test_123",
      {
        accountId: "acct_1",
        orderId: ORDER.id,
        currency: "AUD",
        lines: [{ name: "Flat white", unitAmountCents: 450, quantity: 3 }],
        successUrl: "http://localhost:3100/success",
        cancelUrl: "http://localhost:3100/cancel",
        expiresAtUnix: 1_800_001_800,
      },
      { fetchImpl: wrapped, idempotencyKey: "checkout-order_1-1" }
    );

    expect(seenHeaders["stripe-account"]).toBe("acct_1");
    expect(seenBody).toContain("metadata%5BorderId%5D=order_1");
    expect(seenBody).not.toContain("application_fee");
  });

  it("retrieves the session on the café account for reuse checks", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const wrapped = (async (input: URL | RequestInfo, init?: RequestInit) => {
      seenUrl = String(input);
      seenHeaders = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([key, value]) => [
          String(key).toLowerCase(),
          String(value),
        ])
      );
      return new Response(
        JSON.stringify({ id: "cs_1", status: "open", payment_status: "unpaid", expires_at: 99 }),
        { status: 200 }
      );
    }) as typeof fetch;

    const session = await retrieveCheckoutSession("sk_test_123", "acct_1", "cs_1", {
      fetchImpl: wrapped,
    });
    expect(seenUrl).toContain("/v1/checkout/sessions/cs_1");
    expect(seenHeaders["stripe-account"]).toBe("acct_1");
    expect(session.status).toBe("open");
  });
});

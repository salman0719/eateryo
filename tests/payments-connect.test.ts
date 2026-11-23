import { describe, expect, it } from "vitest";

import { createCoreAccount } from "@/features/payments/provider";

/**
 * Connect route regression (2026-11-21): Accounts v2 is JSON-only.
 * Form-encoding drew a 415 from Stripe, which the route surfaces as
 * `provider_unavailable` (503, "Payments are unavailable"). The body must
 * also use the v2 shape — nested capabilities/responsibilities, country on
 * `identity` — proven live against the sandbox.
 */

function captureFetch() {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  let seenBody = "";
  const wrapped = (async (input: URL | RequestInfo, init?: RequestInit) => {
    seenUrl = String(input);
    seenHeaders = Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([key, value]) => [
        String(key).toLowerCase(),
        String(value),
      ])
    );
    seenBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: "acct_1", livemode: false }), { status: 200 });
  }) as typeof fetch;
  return { wrapped, seen: () => ({ seenUrl, seenHeaders, seenBody }) };
}

describe("createCoreAccount (Accounts v2 JSON)", () => {
  it("posts JSON with the merchant capability and stripe-collected responsibilities", async () => {
    const { wrapped, seen } = captureFetch();
    const ref = await createCoreAccount(
      "sk_test_123",
      { country: "AU" },
      { fetchImpl: wrapped, idempotencyKey: "eateryo-connect-restaurant_1" }
    );
    expect(ref).toEqual({ id: "acct_1", livemode: false });

    const { seenUrl, seenHeaders, seenBody } = seen();
    expect(seenUrl).toBe("https://api.stripe.com/v2/core/accounts");
    expect(seenHeaders["content-type"]).toBe("application/json");
    expect(seenHeaders["idempotency-key"]).toBe("eateryo-connect-restaurant_1");
    const body = JSON.parse(seenBody) as Record<string, unknown>;
    expect(body.dashboard).toBe("full");
    expect(body.identity).toEqual({ country: "au" });
    expect(body.configuration).toEqual({
      merchant: { capabilities: { card_payments: { requested: true } } },
    });
    expect(body.defaults).toEqual({
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
    });
    expect(body).not.toHaveProperty("contact_email");
  });

  it("passes the contact email through when supplied", async () => {
    const { wrapped, seen } = captureFetch();
    await createCoreAccount(
      "sk_test_123",
      { country: "AU", email: "cafe@example.com" },
      { fetchImpl: wrapped }
    );
    const body = JSON.parse(seen().seenBody) as Record<string, unknown>;
    expect(body.contact_email).toBe("cafe@example.com");
  });

  it("throws a stripe_ error on non-2xx so the route maps it to 503", async () => {
    const failing = (async () => new Response("{}", { status: 415 })) as typeof fetch;
    await expect(createCoreAccount("sk_test_123", {}, { fetchImpl: failing })).rejects.toThrow(
      "stripe_account_create_failed:415"
    );
  });
});

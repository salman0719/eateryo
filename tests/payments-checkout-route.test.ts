import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as mintCheckout } from "@/app/api/orders/[orderId]/checkout/route";
import { POST as placeOrderRoute } from "@/app/api/orders/route";
import { createMenuForUser } from "@/features/menus/repo";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { restaurantPaymentAccount } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * Commit 3 follow-up (two-device pass): return URLs follow the diner's
 * page, not the server-perceived URL. A phone tap behind a proxy used to
 * mint `success_url`/`cancel_url` against the machine's own origin
 * (`http://localhost:3100/…` on a dev LAN), so Stripe bounced the diner
 * to a page their phone could never open. The checkout route now prefers
 * the browser's `Origin` header and only falls back to `request.url`.
 */

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(async () => ({
    id: "cs_test_origin_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_origin_1",
  })),
  retrieveCheckoutSession: vi.fn(async () => null),
}));

vi.mock("@/features/payments/provider", () => ({
  getStripeSecret: () => "sk_test_checkout_origin",
  createCheckoutSession: mocks.createCheckoutSession,
  retrieveCheckoutSession: mocks.retrieveCheckoutSession,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

const holder: { db: TestDb | null } = { db: null };

let publishedDoc: MenuDocument;
const menuId = "menu-checkout-origin";
const slug = "cafe-checkout-origin";
let callerCounter = 0;

function menuDoc(): MenuDocument {
  return menuDocumentSchema.parse({
    ...createSampleMenuDocument(),
    id: menuId,
    title: "Cafe Checkout Origin",
    currency: "AUD",
  });
}

function callerHeaders(ip = `10.2.0.${(callerCounter += 1)}`): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": ip };
}

function sampleLine() {
  const item = publishedDoc.categories
    .flatMap((category) => category.items)
    .find((candidate) => candidate.available !== false)!;
  return {
    menuItemId: item.id,
    ...(item.variants.length > 0 ? { variantName: item.variants[0].name } : {}),
    quantity: 1,
  };
}

async function placeAudOrder(ip?: string): Promise<{ orderId: string; token: string }> {
  const placed = await placeOrderRoute(
    new Request("http://test.local/api/orders", {
      method: "POST",
      headers: callerHeaders(ip),
      body: JSON.stringify({
        restaurantSlug: slug,
        slug,
        tableLabel: "7",
        note: null,
        lines: [sampleLine()],
      }),
    })
  );
  expect(placed.status).toBe(201);
  const body = await placed.json();
  return { orderId: body.order.id, token: body.tracking.token };
}

function checkoutRequest(
  orderId: string,
  token: string,
  url: string,
  headers: Record<string, string>,
  ip?: string
): Request {
  return new Request(url, {
    method: "POST",
    headers: { ...callerHeaders(ip), ...headers },
    body: JSON.stringify({ trackingToken: token }),
  });
}

function mintedUrls(): { successUrl: string; cancelUrl: string } {
  // The mock takes no parameters; recover the captured input structurally.
  const calls = mocks.createCheckoutSession.mock.calls as unknown as Array<
    [unknown, { successUrl: string; cancelUrl: string }]
  >;
  const input = calls[0]?.[1];
  expect(input).toBeDefined();
  return input!;
}

beforeEach(async () => {
  const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  holder.db = db;
  mocks.createCheckoutSession.mockClear();
  const owner = await seedUser(db, "checkout-origin-owner@cafe.test", "Owner");
  const restaurant = await createRestaurant(db, owner, "Cafe Checkout Origin");
  publishedDoc = menuDoc();
  await createMenuForUser(db, owner, restaurant.id, publishedDoc);
  await publishMenuForUser(db, owner, menuId);
  await db.insert(restaurantPaymentAccount).values({
    restaurantId: restaurant.id,
    mode: "online",
    status: "active",
    chargesEnabled: true,
    externalAccountId: "acct_test_checkout_origin",
    livemode: false,
    defaultCurrency: "AUD",
  });
}, 30_000);

describe("POST /api/orders/[orderId]/checkout return URLs", () => {
  it("mints Stripe return URLs against the diner's Origin, not the machine URL", async () => {
    const { orderId, token } = await placeAudOrder();
    const response = await mintCheckout(
      checkoutRequest(orderId, token, `http://internal:3000/api/orders/${orderId}/checkout`, {
        host: "internal:3000",
        "x-forwarded-host": "cafe.public",
        origin: "https://cafe.public",
      }),
      { params: Promise.resolve({ orderId }) }
    );
    expect(response.status).toBe(200);
    const urls = mintedUrls();
    expect(urls.successUrl).toBe(
      `https://cafe.public/r/${slug}/t/7?track=${token}&pay=success&session_id={CHECKOUT_SESSION_ID}`
    );
    expect(urls.cancelUrl).toBe(`https://cafe.public/r/${slug}/t/7?track=${token}&pay=cancelled`);
  });

  it("falls back to the request URL when the caller declares no Origin", async () => {
    const { orderId, token } = await placeAudOrder();
    const response = await mintCheckout(
      checkoutRequest(orderId, token, `http://internal:3000/api/orders/${orderId}/checkout`, {
        host: "internal:3000",
      }),
      { params: Promise.resolve({ orderId }) }
    );
    expect(response.status).toBe(200);
    expect(mintedUrls().successUrl.startsWith("http://internal:3000/r/")).toBe(true);
  });

  it("still refuses a hostile Origin before minting anything", async () => {
    const { orderId, token } = await placeAudOrder();
    const response = await mintCheckout(
      checkoutRequest(orderId, token, `http://internal:3000/api/orders/${orderId}/checkout`, {
        host: "internal:3000",
        origin: "https://evil.example",
      }),
      { params: Promise.resolve({ orderId }) }
    );
    expect(response.status).toBe(403);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

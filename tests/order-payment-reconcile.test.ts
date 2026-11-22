import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as paymentRead } from "@/app/api/orders/[orderId]/payment/route";
import { POST as placeOrderRoute } from "@/app/api/orders/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { order as orderTable, restaurantPaymentAccount } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * Receipt self-heal tests for `POST /api/orders/[orderId]/payment`.
 *
 * The Stripe return page polls this route, so when the live session says
 * paid for this order it must apply the same forward-only transition the
 * webhook would have — without ever moving a terminal row backwards or
 * clearing fields a previous writer stored. PGlite + real handler, Stripe
 * stubbed at `fetch`, bearer proof via the tracking token.
 */

const holder: { db: TestDb | null } = { db: null };

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

const SESSION_ID = "cs_test_reconcile_1";
const ACCOUNT_ID = "acct_test_reconcile";

let ownerId: string;
let restaurantId: string;
let publishedDoc: MenuDocument;
let callerCounter = 0;
const menuId = "menu-payment-reconcile";
const OLD_ENV = process.env.STRIPE_SECRET_KEY;

function stripeSession(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_test_paid_1",
    metadata: { orderId },
    ...overrides,
  };
}

function stubStripe(json: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
  );
}

function paymentRequest(orderId: string, body: unknown): Request {
  callerCounter += 1;
  return new Request(`http://test.local/api/orders/${orderId}/payment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.9.0.${callerCounter}`,
    },
    body: JSON.stringify(body),
  });
}

function paymentParams(orderId: string): { params: Promise<{ orderId: string }> } {
  return { params: Promise.resolve({ orderId }) };
}

async function placePricedOrder(): Promise<{ id: string; trackingToken: string }> {
  const { setRestaurantSlugForUser } = await import("@/features/tables/repo");
  await setRestaurantSlugForUser(holder.db!, ownerId, restaurantId, "cafe-reconcile");
  const item = publishedDoc.categories
    .flatMap((category) => category.items)
    .find((candidate) => candidate.available !== false)!;
  const res = await placeOrderRoute(
    new Request("http://test.local/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.8.0.7" },
      body: JSON.stringify({
        restaurantSlug: "cafe-reconcile",
        tableLabel: "1",
        note: null,
        lines: [
          {
            menuItemId: item.id,
            ...(item.variants.length > 0 ? { variantName: item.variants[0].name } : {}),
            quantity: 1,
            menuSlug: "cafe-reconcile",
          },
        ],
      }),
    })
  );
  expect(res.status).toBe(201);
  const payload = await res.json();
  return { id: payload.order.id, trackingToken: payload.tracking.token };
}

async function readOrder(id: string) {
  const rows = await holder.db!.select().from(orderTable).where(eq(orderTable.id, id));
  return rows[0]!;
}

beforeEach(async () => {
  const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  holder.db = db;
  ownerId = await seedUser(holder.db, "reconcile-owner@cafe.test", "Owner");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Café Reconcile")).id;
  publishedDoc = menuDocumentSchema.parse({
    ...createSampleMenuDocument(),
    id: menuId,
    title: "Café Reconcile",
    currency: "USD",
  });
  await createMenuForUser(holder.db, ownerId, restaurantId, publishedDoc);
  await publishMenuForUser(holder.db, ownerId, menuId);
  await holder.db.insert(restaurantPaymentAccount).values({
    restaurantId,
    provider: "stripe",
    mode: "online",
    livemode: false,
    externalAccountId: ACCOUNT_ID,
    status: "active",
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_reconcile_key";
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
  if (OLD_ENV === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = OLD_ENV;
});

describe("POST /api/orders/[orderId]/payment self-heal", () => {
  it("applies paid when the live session says paid for this order", async () => {
    const { id, trackingToken } = await placePricedOrder();
    await holder
      .db!.update(orderTable)
      .set({ paymentStatus: "pending", paymentProvider: "stripe", paymentReference: SESSION_ID })
      .where(eq(orderTable.id, id));
    stubStripe(stripeSession(id));

    const res = await paymentRead(
      paymentRequest(id, { trackingToken, sessionId: SESSION_ID }),
      paymentParams(id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentStatus).toBe("paid");
    expect(body.live).toEqual({ paid: true, state: "complete" });

    const row = await readOrder(id);
    expect(row.paymentStatus).toBe("paid");
    expect(row.paymentProvider).toBe("stripe");
    expect(row.paymentReference).toBe(SESSION_ID);
    expect(row.paymentIntentId).toBe("pi_test_paid_1");
    expect(row.paidAt).not.toBeNull();
  });

  it("ignores a session minted for another order", async () => {
    const { id, trackingToken } = await placePricedOrder();
    await holder
      .db!.update(orderTable)
      .set({ paymentStatus: "pending", paymentProvider: "stripe", paymentReference: SESSION_ID })
      .where(eq(orderTable.id, id));
    stubStripe(stripeSession("some-other-order"));

    const res = await paymentRead(
      paymentRequest(id, { trackingToken, sessionId: SESSION_ID }),
      paymentParams(id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentStatus).toBe("pending");
    expect(body.live).toBeNull();

    const row = await readOrder(id);
    expect(row.paymentStatus).toBe("pending");
    expect(row.paidAt).toBeNull();
  });

  it("leaves stored state alone when Stripe says unpaid", async () => {
    const { id, trackingToken } = await placePricedOrder();
    await holder
      .db!.update(orderTable)
      .set({ paymentStatus: "pending", paymentProvider: "stripe", paymentReference: SESSION_ID })
      .where(eq(orderTable.id, id));
    stubStripe(stripeSession(id, { payment_status: "unpaid", status: "open" }));

    const res = await paymentRead(
      paymentRequest(id, { trackingToken, sessionId: SESSION_ID }),
      paymentParams(id)
    );
    const body = await res.json();
    expect(body.paymentStatus).toBe("pending");
    expect(body.live).toEqual({ paid: false, state: "open" });

    const row = await readOrder(id);
    expect(row.paymentStatus).toBe("pending");
    expect(row.paidAt).toBeNull();
  });

  it("never rewrites an already-paid row: no paidAt bump, no intent wipe", async () => {
    const { id, trackingToken } = await placePricedOrder();
    const settledAt = new Date("2026-01-01T00:00:00.000Z");
    await holder
      .db!.update(orderTable)
      .set({
        paymentStatus: "paid",
        paymentProvider: "stripe",
        paymentReference: SESSION_ID,
        paymentIntentId: "pi_keep_me",
        paidAt: settledAt,
      })
      .where(eq(orderTable.id, id));
    // A re-poll whose Stripe read carries no intent must not clear the one
    // the webhook (or the first heal) stored.
    stubStripe(stripeSession(id, { payment_intent: null }));

    const res = await paymentRead(
      paymentRequest(id, { trackingToken, sessionId: SESSION_ID }),
      paymentParams(id)
    );
    expect((await res.json()).paymentStatus).toBe("paid");

    const row = await readOrder(id);
    expect(row.paidAt?.getTime()).toBe(settledAt.getTime());
    expect(row.paymentIntentId).toBe("pi_keep_me");
  });

  it("never moves a refunded row backwards to paid", async () => {
    const { id, trackingToken } = await placePricedOrder();
    await holder
      .db!.update(orderTable)
      .set({
        paymentStatus: "refunded",
        paymentProvider: "stripe",
        paymentReference: SESSION_ID,
        paymentIntentId: "pi_test_paid_1",
        paidAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .where(eq(orderTable.id, id));
    stubStripe(stripeSession(id));

    const res = await paymentRead(
      paymentRequest(id, { trackingToken, sessionId: SESSION_ID }),
      paymentParams(id)
    );
    expect((await res.json()).paymentStatus).toBe("refunded");

    const row = await readOrder(id);
    expect(row.paymentStatus).toBe("refunded");
  });
});

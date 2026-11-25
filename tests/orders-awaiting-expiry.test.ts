import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getBoard } from "@/app/api/orders/route";
import { POST as postCheckout } from "@/app/api/orders/[orderId]/checkout/route";
import { POST as postPayment } from "@/app/api/orders/[orderId]/payment/route";
import {
  AWAITING_CLEAR_AFTER_MS,
  AWAITING_PAYMENT_TTL_MS,
  awaitingClearAfterMs,
  awaitingPaymentTtlMs,
  createOrderTrackingToken,
  expireStaleAwaitingPaymentsForStaff,
  isAwaitingClearable,
  isAwaitingExpired,
  listAwaitingPaymentForStaff,
} from "@/features/orders/repo";
import { fallbackCopy } from "@/features/payments/resolver";
import { createRestaurant } from "@/features/tenancy/repo";
import { order as orderTable, orderLine as orderLineTable } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * Abandoned-card policy: an unpaid card ticket lives 30 minutes, staff may
 * clear it after 5, and the pay link dies on either. These pin the pure
 * boundaries, the DB-only sweep's aim (only stale *sessionless* card
 * tickets, kept as `cancelled` — anything naming a session belongs to the
 * webhook), and the expired pay-link answers on both diner routes — plus
 * that the sweep rides the board poll.
 */

const holder: { db: TestDb | null; userId: string | null } = {
  db: null,
  userId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

let ownerId: string;
let outsiderId: string;
let restaurantId: string;
let callerCounter = 100;

function callerHeaders(): Record<string, string> {
  callerCounter += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.9.${callerCounter}` };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: callerHeaders(),
    body: JSON.stringify(body),
  });
}

function orderParams(orderId: string): { params: Promise<{ orderId: string }> } {
  return { params: Promise.resolve({ orderId }) };
}

beforeEach(async () => {
  const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
  holder.db = (await createTestDb()).db;
  ownerId = await seedUser(holder.db, "expiry-owner@cafe.test", "Owner");
  outsiderId = await seedUser(holder.db, "expiry-outsider@cafe.test", "Outsider");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Café Expiry")).id;
  holder.userId = ownerId;
}, 30_000);

/** A kitchen-hidden card ticket of a given age, with one snapshotted line. */
async function insertAwaitingCardOrder(options: {
  ageMin: number;
  paymentStatus?: "unpaid" | "pending" | "failed" | "paid";
  provider?: string | null;
  status?: "new" | "cancelled";
  paymentReference?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const at = new Date(Date.now() - options.ageMin * 60_000);
  await holder.db!.insert(orderTable).values({
    id,
    restaurantId,
    menuId: null,
    menuTitle: "Lunch",
    tableLabel: "3",
    currency: "AUD",
    note: null,
    status: options.status ?? "new",
    totalCents: 1350,
    paymentStatus: options.paymentStatus ?? "unpaid",
    paymentProvider: options.provider === undefined ? "stripe" : options.provider,
    paymentReference: options.paymentReference ?? null,
    createdAt: at,
    updatedAt: at,
  });
  await holder.db!.insert(orderLineTable).values({
    orderId: id,
    menuItemId: "item-pie",
    name: "Pie",
    variantName: null,
    unitPriceCents: 1350,
    quantity: 1,
  });
  return id;
}

async function rowStatus(orderId: string) {
  const rows = await holder
    .db!.select({ status: orderTable.status, paymentStatus: orderTable.paymentStatus })
    .from(orderTable)
    .where(eq(orderTable.id, orderId));
  return rows[0];
}

describe("awaiting-payment expiry helpers", () => {
  const now = new Date("2026-11-21T01:00:00.000Z");

  it("expires at 30 minutes, not before", () => {
    expect(isAwaitingExpired(new Date(now.getTime() - 29 * 60_000), now)).toBe(false);
    expect(isAwaitingExpired(new Date(now.getTime() - 30 * 60_000), now)).toBe(true);
    expect(isAwaitingExpired(new Date(now.getTime() - 31 * 60_000), now)).toBe(true);
  });

  it("lets staff clear at 5 minutes, not before", () => {
    expect(isAwaitingClearable(new Date(now.getTime() - 4 * 60_000), now)).toBe(false);
    expect(isAwaitingClearable(new Date(now.getTime() - 5 * 60_000), now)).toBe(true);
    expect(isAwaitingClearable(new Date(now.getTime() - 6 * 60_000), now)).toBe(true);
  });

  it("tells the diner the link expired with the way back", () => {
    expect(fallbackCopy("expired")).toContain("30 minutes");
  });
});

describe("expireStaleAwaitingPaymentsForStaff", () => {
  it("sweeps only stale unpaid card tickets and keeps them as cancelled", async () => {
    const staleUnpaid = await insertAwaitingCardOrder({ ageMin: 31 });
    const stalePending = await insertAwaitingCardOrder({ ageMin: 45, paymentStatus: "pending" });
    const fresh = await insertAwaitingCardOrder({ ageMin: 5 });
    const stalePaid = await insertAwaitingCardOrder({ ageMin: 40, paymentStatus: "paid" });
    const staleCounter = await insertAwaitingCardOrder({
      ageMin: 40,
      provider: null,
    });

    const result = await expireStaleAwaitingPaymentsForStaff(
      holder.db!,
      ownerId,
      { restaurantId },
      new Date()
    );
    expect(result.expired).toBe(2);

    // Swept rows stay in the DB as cancelled with the payment state kept.
    expect(await rowStatus(staleUnpaid)).toMatchObject({
      status: "cancelled",
      paymentStatus: "unpaid",
    });
    expect(await rowStatus(stalePending)).toMatchObject({
      status: "cancelled",
      paymentStatus: "pending",
    });
    // Everything else is untouched.
    expect(await rowStatus(fresh)).toMatchObject({ status: "new" });
    expect(await rowStatus(stalePaid)).toMatchObject({ status: "new" });
    expect(await rowStatus(staleCounter)).toMatchObject({ status: "new" });

    // The pill no longer lists swept tickets — only the fresh one.
    const awaiting = await listAwaitingPaymentForStaff(holder.db!, ownerId, { restaurantId });
    expect(awaiting.orders.map((order) => order.id)).toEqual([fresh]);
  });

  it("leaves stale tickets that name a session for the webhook — never cancels blind", async () => {
    const withSession = await insertAwaitingCardOrder({
      ageMin: 45,
      paymentStatus: "pending",
      paymentReference: "cs_test_open",
    });
    const abandoned = await insertAwaitingCardOrder({ ageMin: 45 });

    const result = await expireStaleAwaitingPaymentsForStaff(
      holder.db!,
      ownerId,
      { restaurantId },
      new Date()
    );
    expect(result).toMatchObject({ expired: 1, deferred: 1 });

    // The session ticket stays live: `checkout.session.expired` owns its
    // expiry and `payment-check` owns a missed paid event. Cancelling it
    // here could kill a paid order.
    expect(await rowStatus(withSession)).toMatchObject({
      status: "new",
      paymentStatus: "pending",
    });
    // The truly abandoned one (no session ever minted) is cancelled with
    // its state kept.
    expect(await rowStatus(abandoned)).toMatchObject({
      status: "cancelled",
      paymentStatus: "unpaid",
    });
  });

  it("needs no Stripe configuration: only sessionless age matters", async () => {
    const stale = await insertAwaitingCardOrder({ ageMin: 45 });
    const staleSession = await insertAwaitingCardOrder({
      ageMin: 45,
      paymentReference: "cs_test_live",
    });

    // No linked account in this DB and no secret: the DB-only sweep does
    // not care — it sweeps the sessionless ticket and defers the other.
    const result = await expireStaleAwaitingPaymentsForStaff(
      holder.db!,
      ownerId,
      { restaurantId },
      new Date()
    );
    expect(result).toMatchObject({ expired: 1, deferred: 1 });
    expect(await rowStatus(stale)).toMatchObject({ status: "cancelled" });
    expect(await rowStatus(staleSession)).toMatchObject({ status: "new" });
  });

  it("sweeps nothing fresh and refuses another tenant", async () => {
    await insertAwaitingCardOrder({ ageMin: 5 });
    const result = await expireStaleAwaitingPaymentsForStaff(
      holder.db!,
      ownerId,
      { restaurantId },
      new Date()
    );
    expect(result.expired).toBe(0);
    await expect(
      expireStaleAwaitingPaymentsForStaff(holder.db!, outsiderId, { restaurantId }, new Date())
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("test-only TTL override", () => {
  it("defaults to the production windows when nothing is set", () => {
    expect(awaitingPaymentTtlMs({})).toBe(AWAITING_PAYMENT_TTL_MS);
    expect(awaitingClearAfterMs({})).toBe(AWAITING_CLEAR_AFTER_MS);
  });

  it("honors the override outside production", () => {
    const env = {
      NODE_ENV: "test",
      EATERYO_AWAITING_TTL_MS: "120000",
      EATERYO_AWAITING_CLEAR_AFTER_MS: "30000",
    };
    expect(awaitingPaymentTtlMs(env)).toBe(120_000);
    expect(awaitingClearAfterMs(env)).toBe(30_000);
  });

  it("ignores the override in production", () => {
    const env = {
      NODE_ENV: "production",
      EATERYO_AWAITING_TTL_MS: "1000",
      EATERYO_AWAITING_CLEAR_AFTER_MS: "1000",
    };
    expect(awaitingPaymentTtlMs(env)).toBe(AWAITING_PAYMENT_TTL_MS);
    expect(awaitingClearAfterMs(env)).toBe(AWAITING_CLEAR_AFTER_MS);
  });

  it("falls back on blank or non-positive values", () => {
    for (const raw of ["", "0", "-5000", "soon", "12.5"]) {
      expect(awaitingPaymentTtlMs({ EATERYO_AWAITING_TTL_MS: raw })).toBe(AWAITING_PAYMENT_TTL_MS);
    }
  });

  it("sweeps on the overridden clock end to end", async () => {
    const key = "EATERYO_AWAITING_TTL_MS";
    const previous = process.env[key];
    process.env[key] = "120000";
    try {
      const young = await insertAwaitingCardOrder({ ageMin: 1 });
      const old = await insertAwaitingCardOrder({ ageMin: 3 });
      const result = await expireStaleAwaitingPaymentsForStaff(
        holder.db!,
        ownerId,
        { restaurantId },
        new Date()
      );
      expect(result.expired).toBe(1);
      expect(await rowStatus(old)).toMatchObject({ status: "cancelled" });
      expect(await rowStatus(young)).toMatchObject({ status: "new" });
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });
});

describe("expired pay-link responses", () => {
  it("refuses a fresh checkout session for a stale ticket and cancels it", async () => {
    const orderId = await insertAwaitingCardOrder({ ageMin: 31 });
    const { token } = await createOrderTrackingToken(holder.db!, orderId);

    const res = await postCheckout(
      jsonRequest(`http://test.local/api/orders/${orderId}/checkout`, {
        trackingToken: token,
      }),
      orderParams(orderId)
    );
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("order_expired");
    expect(await rowStatus(orderId)).toMatchObject({
      status: "cancelled",
      paymentStatus: "unpaid",
    });
  });

  it("still mints the pay link for a fresh ticket (no account here, so counter)", async () => {
    const orderId = await insertAwaitingCardOrder({ ageMin: 5 });
    const { token } = await createOrderTrackingToken(holder.db!, orderId);

    const res = await postCheckout(
      jsonRequest(`http://test.local/api/orders/${orderId}/checkout`, {
        trackingToken: token,
      }),
      orderParams(orderId)
    );
    // No payment account in this DB: the resolver says counter — but the
    // ticket is NOT refused as expired.
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("pay_unavailable");
    expect(await rowStatus(orderId)).toMatchObject({ status: "new" });
  });

  it("reads an expired ticket as expired, never with a pay button", async () => {
    const orderId = await insertAwaitingCardOrder({ ageMin: 31, paymentStatus: "pending" });
    const { token } = await createOrderTrackingToken(holder.db!, orderId);

    const res = await postPayment(
      jsonRequest(`http://test.local/api/orders/${orderId}/payment`, {
        trackingToken: token,
      }),
      orderParams(orderId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkout.mode).toBe("at_venue");
    expect(body.checkout.reason).toBe("expired");
    expect(body.checkout.copy).toContain("30 minutes");
    expect(await rowStatus(orderId)).toMatchObject({ status: "cancelled" });
  });

  it("refuses an oversized checkout body before parsing it", async () => {
    const orderId = await insertAwaitingCardOrder({ ageMin: 5 });
    const res = await postCheckout(
      new Request(`http://test.local/api/orders/${orderId}/checkout`, {
        method: "POST",
        headers: { ...callerHeaders(), "content-length": "99999" },
        body: JSON.stringify({ trackingToken: "x" }),
      }),
      orderParams(orderId)
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });

  it("rate-limits checkout attempts and says when to retry", async () => {
    const orderId = await insertAwaitingCardOrder({ ageMin: 5 });
    const ip = "203.0.113.77";
    const attempt = () =>
      postCheckout(
        new Request(`http://test.local/api/orders/${orderId}/checkout`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ trackingToken: "no-such-token" }),
        }),
        orderParams(orderId)
      );
    for (let n = 0; n < 12; n += 1) {
      const res = await attempt();
      expect(res.status).toBe(404);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect((await blocked.json()).error.code).toBe("rate_limited");
  });

  it("sweeps stale tickets on the next board poll", async () => {
    const stale = await insertAwaitingCardOrder({ ageMin: 31 });
    const fresh = await insertAwaitingCardOrder({ ageMin: 5 });

    const res = await getBoard(
      new Request(`http://test.local/api/orders?restaurantId=${restaurantId}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The stale ticket never reaches the board; the fresh counter-style
    // assertions below pin the poll still working.
    expect(body.orders.map((order: { id: string }) => order.id)).not.toContain(stale);
    // The pill rides the same poll — no second request from the board.
    expect(body.awaiting.orders.map((order: { id: string }) => order.id)).toEqual([fresh]);
    expect(await rowStatus(stale)).toMatchObject({ status: "cancelled" });
    expect(await rowStatus(fresh)).toMatchObject({ status: "new" });
  });
});

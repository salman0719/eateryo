import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { createRestaurant } from "@/features/tenancy/repo";
import { signTestPayload, verifyStripeSignature } from "@/features/payments/verify";
import { canTransitionPaymentStatus } from "@/features/payments/schema";
import { order as orderTable, restaurantPaymentAccount } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for Commit 2 (PGlite + real handler, no Stripe calls).
 *
 * They pin the webhook's guarantees from the roadmap: raw-body signature
 * verification, the replay guard, pair authorisation (event.account ↔ the
 * order's restaurant), forward-only paid-marking, and the dashboard-refund
 * path. Handler-level, so the same cases also cover rows 12–15 of the
 * acceptance matrix once the suite runs against the sandbox listener.
 */

const WEBHOOK_SECRET = "whsec_test_commit2";

const holder: { db: TestDb | null } = { db: null };

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

async function initTestDb(): Promise<TestDb> {
  const { createTestDb } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  return db;
}

async function setupCafe(
  db: TestDb,
  email: string,
  name: string,
  externalAccountId: string
): Promise<string> {
  const { seedUser } = await import("./helpers/pg-test-db");
  const userId = await seedUser(db, email, name);
  const restaurantId = (await createRestaurant(db, userId, name)).id;
  await db.insert(restaurantPaymentAccount).values({
    restaurantId,
    externalAccountId,
    livemode: false,
    status: "pending",
    connectedAt: new Date(),
  });
  return restaurantId;
}

async function placeUnpaidOrder(db: TestDb, id: string, restaurantId: string): Promise<void> {
  // Explicit stamps: PGlite reads tz-naive `timestamp` columns back in the
  // machine's zone, so a DB-default clock cannot be compared against the
  // JS clock (see the paid-marking test below). Production code always
  // writes these columns explicitly for the same reason.
  const past = new Date(Date.now() - 3_600_000);
  await db.insert(orderTable).values({
    id,
    restaurantId,
    menuTitle: "Test menu",
    tableLabel: "7",
    status: "new",
    totalCents: 1350,
    createdAt: past,
    updatedAt: past,
  });
}

async function paymentStatusOf(orderId: string): Promise<string | null> {
  const rows = await holder
    .db!.select({ status: orderTable.paymentStatus })
    .from(orderTable)
    .where(eq(orderTable.id, orderId));
  return rows[0]?.status ?? null;
}

function sessionPayload(
  sessionId: string,
  orderId: string,
  paymentIntent: string | null = "pi_test_1"
) {
  return JSON.stringify({
    id: `evt_for_${sessionId}`,
    object: "event",
    type: "checkout.session.completed",
    account: "acct_cafe_a",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        metadata: { orderId },
        payment_intent: paymentIntent,
      },
    },
  });
}

function webhookRequest(rawBody: string, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://test.local/api/stripe/webhook", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function signedRequest(rawBody: string, secret: string = WEBHOOK_SECRET): Request {
  return webhookRequest(rawBody, signTestPayload(rawBody, secret));
}

beforeEach(async () => {
  holder.db = await initTestDb();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
}, 30_000);

describe("verifyStripeSignature", () => {
  it("accepts a well-formed header and rejects the standard failures", () => {
    const body = '{"id":"evt_1"}';
    const now = 1_800_000_000;
    const good = signTestPayload(body, WEBHOOK_SECRET, now);
    expect(verifyStripeSignature(body, good, WEBHOOK_SECRET, now).ok).toBe(true);

    expect(verifyStripeSignature(body, null, WEBHOOK_SECRET, now)).toEqual({
      ok: false,
      failure: "missing_header",
    });
    expect(verifyStripeSignature(body, "garbage", WEBHOOK_SECRET, now).failure).toBe(
      "malformed_header"
    );
    expect(verifyStripeSignature(body, "t=123", WEBHOOK_SECRET, now).failure).toBe(
      "no_v1_signature"
    );
    const stale = signTestPayload(body, WEBHOOK_SECRET, now - 301);
    expect(verifyStripeSignature(body, stale, WEBHOOK_SECRET, now).failure).toBe("stale_timestamp");
    const tampered = signTestPayload('{"id":"evt_2"}', WEBHOOK_SECRET, now);
    expect(verifyStripeSignature(body, tampered, WEBHOOK_SECRET, now).failure).toBe("mismatch");
    expect(verifyStripeSignature(body, good, "whsec_wrong", now).failure).toBe("mismatch");
  });
});

describe("payment transitions", () => {
  it("moves forward only, with the refund as the one exit from paid", () => {
    expect(canTransitionPaymentStatus("unpaid", "paid")).toBe(true);
    expect(canTransitionPaymentStatus("failed", "paid")).toBe(true);
    expect(canTransitionPaymentStatus("paid", "refunded")).toBe(true);
    expect(canTransitionPaymentStatus("paid", "unpaid")).toBe(false);
    expect(canTransitionPaymentStatus("paid", "failed")).toBe(false);
    expect(canTransitionPaymentStatus("refunded", "paid")).toBe(false);
    expect(canTransitionPaymentStatus("unpaid", "unpaid")).toBe(true);
  });
});

describe("POST /api/stripe/webhook", () => {
  it("answers 503 when the webhook secret is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await stripeWebhook(signedRequest("{}"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("webhook_not_configured");
  });

  it("refuses a missing, forged, or stale signature with 400", async () => {
    const raw = sessionPayload("cs_test_1", "order-1");
    const missing = await stripeWebhook(webhookRequest(raw, null));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("invalid_signature");

    const forged = await stripeWebhook(webhookRequest(raw, "t=123,v1=deadbeef"));
    expect(forged.status).toBe(400);

    const otherBody = sessionPayload("cs_test_2", "order-1");
    const swapped = await stripeWebhook(
      webhookRequest(otherBody, signTestPayload(raw, WEBHOOK_SECRET))
    );
    expect(swapped.status).toBe(400);
  });

  it("marks an unpaid order paid and stamps the board-visible clock", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-paid-1", restaurantId);

    const res = await stripeWebhook(signedRequest(sessionPayload("cs_test_paid", "order-paid-1")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      received: true,
      outcome: "applied",
      orderId: "order-paid-1",
      paymentStatus: "paid",
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const rows = await holder
      .db!.select()
      .from(orderTable)
      .where(eq(orderTable.id, "order-paid-1"));
    const row = rows[0]!;
    expect(row.paymentStatus).toBe("paid");
    expect(row.paymentProvider).toBe("stripe");
    expect(row.paymentReference).toBe("cs_test_paid");
    expect(row.paymentIntentId).toBe("pi_test_1");
    expect(row.paidAt).toBeInstanceOf(Date);
    // The kitchen status is untouched, but the board poll sees the change:
    // the fixture was stamped an hour ago, the webhook stamps now.
    expect(row.status).toBe("new");
    expect(row.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // No secret material in the response.
    expect(JSON.stringify(body)).not.toContain("whsec");
  });

  it("treats a redelivered event as a duplicate without touching the order", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-dup-1", restaurantId);
    const raw = sessionPayload("cs_test_dup", "order-dup-1");

    expect((await (await stripeWebhook(signedRequest(raw))).json()).outcome).toBe("applied");
    const replay = await stripeWebhook(signedRequest(raw));
    expect(replay.status).toBe(200);
    expect((await replay.json()).outcome).toBe("duplicate");
    expect(await paymentStatusOf("order-dup-1")).toBe("paid");
  });

  it("ignores a stale completion for an order that is already paid", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-stale-1", restaurantId);
    await stripeWebhook(signedRequest(sessionPayload("cs_test_first", "order-stale-1")));

    const late = JSON.stringify({
      id: "evt_late_duplicate",
      object: "event",
      type: "checkout.session.completed",
      account: "acct_cafe_a",
      data: {
        object: {
          id: "cs_test_late",
          object: "checkout.session",
          metadata: { orderId: "order-stale-1" },
          payment_intent: "pi_test_late",
        },
      },
    });
    const res = await stripeWebhook(signedRequest(late));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("applied");
    // Already paid: the second session does not rewrite the first receipt.
    const row = (
      await holder.db!.select().from(orderTable).where(eq(orderTable.id, "order-stale-1"))
    )[0]!;
    expect(row.paymentReference).toBe("cs_test_first");
  });

  it("never lets a stale event move a paid order backwards", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-back-1", restaurantId);
    await stripeWebhook(signedRequest(sessionPayload("cs_test_ok", "order-back-1")));

    const failed = JSON.stringify({
      id: "evt_late_failure",
      object: "event",
      type: "checkout.session.async_payment_failed",
      account: "acct_cafe_a",
      data: {
        object: {
          id: "cs_test_ok",
          object: "checkout.session",
          metadata: { orderId: "order-back-1" },
        },
      },
    });
    const res = await stripeWebhook(signedRequest(failed));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("ignored");
    expect(await paymentStatusOf("order-back-1")).toBe("paid");
  });

  it("rejects café B's event for café A's order and leaves it unpaid", async () => {
    const restaurantA = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await setupCafe(holder.db!, "b@cafe.test", "Café B", "acct_cafe_b");
    await placeUnpaidOrder(holder.db!, "order-cross-1", restaurantA);

    const raw = JSON.stringify({
      id: "evt_cross_1",
      object: "event",
      type: "checkout.session.completed",
      account: "acct_cafe_b",
      data: {
        object: {
          id: "cs_test_cross",
          object: "checkout.session",
          metadata: { orderId: "order-cross-1" },
          payment_intent: "pi_cross",
        },
      },
    });
    const res = await stripeWebhook(signedRequest(raw));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("ignored");
    expect(await paymentStatusOf("order-cross-1")).toBe("unpaid");
  });

  it("marks a failed payment and still allows the retry to succeed", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-fail-1", restaurantId);
    const failed = JSON.stringify({
      id: "evt_fail_1",
      object: "event",
      type: "checkout.session.async_payment_failed",
      account: "acct_cafe_a",
      data: {
        object: {
          id: "cs_test_fail",
          object: "checkout.session",
          metadata: { orderId: "order-fail-1" },
        },
      },
    });
    const res = await stripeWebhook(signedRequest(failed));
    expect(res.status).toBe(200);
    expect((await res.json()).paymentStatus).toBe("failed");

    const retry = await stripeWebhook(
      signedRequest(sessionPayload("cs_test_retry", "order-fail-1"))
    );
    expect((await retry.json()).paymentStatus).toBe("paid");
  });

  it("moves a paid order to refunded on charge.refunded, and nothing earlier", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-refund-1", restaurantId);
    await placeUnpaidOrder(holder.db!, "order-refund-2", restaurantId);
    await stripeWebhook(signedRequest(sessionPayload("cs_test_ref", "order-refund-1")));

    const refunded = JSON.stringify({
      id: "evt_refund_1",
      object: "event",
      type: "charge.refunded",
      account: "acct_cafe_a",
      data: { object: { id: "ch_test_1", object: "charge", payment_intent: "pi_test_1" } },
    });
    const res = await stripeWebhook(signedRequest(refunded));
    expect(res.status).toBe(200);
    expect((await res.json()).paymentStatus).toBe("refunded");
    expect(await paymentStatusOf("order-refund-1")).toBe("refunded");

    // An unpaid order cannot be refunded into existence.
    const bogus = JSON.stringify({
      id: "evt_refund_2",
      object: "event",
      type: "charge.refunded",
      account: "acct_cafe_a",
      data: { object: { id: "ch_test_2", object: "charge", payment_intent: "pi_unknown" } },
    });
    const res2 = await stripeWebhook(signedRequest(bogus));
    expect((await res2.json()).outcome).toBe("ignored");
    expect(await paymentStatusOf("order-refund-2")).toBe("unpaid");
  });

  it("syncs the cached account status on account.updated without touching orders", async () => {
    const restaurantId = await setupCafe(holder.db!, "a@cafe.test", "Café A", "acct_cafe_a");
    await placeUnpaidOrder(holder.db!, "order-acct-1", restaurantId);
    const raw = JSON.stringify({
      id: "evt_acct_1",
      object: "event",
      type: "account.updated",
      account: "acct_cafe_a",
      data: {
        object: {
          id: "acct_cafe_a",
          object: "account",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    });
    const res = await stripeWebhook(signedRequest(raw));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("applied");

    const accounts = await holder.db!.select().from(restaurantPaymentAccount);
    expect(accounts[0]?.status).toBe("active");
    expect(accounts[0]?.chargesEnabled).toBe(true);
    expect(accounts[0]?.statusCheckedAt).toBeInstanceOf(Date);
    expect(await paymentStatusOf("order-acct-1")).toBe("unpaid");
  });

  it("ignores account.updated for an account it has never seen", async () => {
    const raw = JSON.stringify({
      id: "evt_acct_unknown",
      object: "event",
      type: "account.updated",
      account: "acct_stranger",
      data: { object: { id: "acct_stranger", object: "account", charges_enabled: true } },
    });
    const res = await stripeWebhook(signedRequest(raw));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("ignored");
  });

  it("ignores unknown event types and events without order metadata", async () => {
    const unknown = JSON.stringify({
      id: "evt_unknown_1",
      object: "event",
      type: "invoice.paid",
      data: { object: { id: "in_1", object: "invoice" } },
    });
    const res = await stripeWebhook(signedRequest(unknown));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("ignored");

    const noMetadata = JSON.stringify({
      id: "evt_nometa_1",
      object: "event",
      type: "checkout.session.completed",
      account: "acct_cafe_a",
      data: { object: { id: "cs_x", object: "checkout.session", metadata: {} } },
    });
    const res2 = await stripeWebhook(signedRequest(noMetadata));
    expect((await res2.json()).outcome).toBe("ignored");
  });

  it("refuses an oversized payload before parsing it", async () => {
    const big = JSON.stringify({ id: "evt_big", padding: "x".repeat(70 * 1024) });
    const res = await stripeWebhook(signedRequest(big));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });
});

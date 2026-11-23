import { and, eq } from "drizzle-orm";

import type { TenancyDb } from "@/features/tenancy/repo";
import {
  order as orderTable,
  restaurantPaymentAccount,
  stripeEvent as stripeEventTable,
} from "@/lib/db/schema";

import {
  canTransitionPaymentStatus,
  isPaymentStatus,
  type PaymentStatus,
  type StripeWebhookEvent,
} from "./schema";

/**
 * Server application of a verified Stripe webhook event (Commit 2).
 *
 * The route verifies the signature; everything after that lives here so
 * tests exercise the rules without HTTP:
 * - the replay guard (`stripe_event.id` is the primary key — a redelivered
 *   event inserts nothing and changes nothing),
 * - pair authorisation (`event.account` must map to the payment account of
 *   the restaurant that owns `metadata.orderId`; a mismatch is a 200 with a
 *   log line, never a 4xx that makes Stripe retry forever),
 * - forward-only payment transitions (a stale event never moves a paid
 *   order backwards; only `charge.refunded` leaves `paid`),
 * - `account.updated` syncing the cached account status (it never touches
 *   orders).
 *
 * Every payment transition stamps `updatedAt` from the server clock, so the
 * staff board's `since` poll picks the chip change up like any other edit.
 */

export type WebhookOutcome = "applied" | "duplicate" | "ignored";

export interface WebhookResult {
  outcome: WebhookOutcome;
  /** Why an event was ignored (log line, never a client-facing sentence). */
  reason?: string;
  orderId?: string;
  paymentStatus?: PaymentStatus;
}

type OrderRow = typeof orderTable.$inferSelect;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `payment_intent` arrives as an id string or an expanded object. */
function intentId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  const record = asRecord(value);
  const id = record ? asString(record["id"]) : null;
  return id;
}

async function findPaymentAccount(
  db: TenancyDb,
  externalAccountId: string
): Promise<typeof restaurantPaymentAccount.$inferSelect | null> {
  const rows = await db
    .select()
    .from(restaurantPaymentAccount)
    .where(eq(restaurantPaymentAccount.externalAccountId, externalAccountId))
    .limit(1);
  return rows[0] ?? null;
}

async function findOrder(db: TenancyDb, orderId: string): Promise<OrderRow | null> {
  const rows = await db.select().from(orderTable).where(eq(orderTable.id, orderId)).limit(1);
  return rows[0] ?? null;
}

async function setPaymentStatus(
  db: TenancyDb,
  order: OrderRow,
  status: PaymentStatus,
  patch: Partial<
    Pick<OrderRow, "paymentProvider" | "paymentReference" | "paymentIntentId" | "paidAt">
  >,
  now: Date
): Promise<OrderRow> {
  const updated = await db
    .update(orderTable)
    .set({ paymentStatus: status, ...patch, updatedAt: now })
    .where(eq(orderTable.id, order.id))
    .returning();
  const row = updated[0];
  if (!row) throw new Error(`webhook lost order ${order.id} mid-update`);
  return row;
}

/**
 * Conservative cached-status mapping for `account.updated` and the manual
 * check. `active` means Stripe says the account can charge
 * (`charges_enabled`): a fresh account routinely has payouts still pending
 * verification while charges already work, and that must not read as
 * "paused" — payouts pending never blocks a charge. A submitted account
 * that still cannot charge needs action; anything else is still
 * onboarding. The Commit 1 resolver refines this into the card states —
 * this column never gates a charge by itself.
 */
export function mapAccountStatus(input: {
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  detailsSubmitted: boolean | null;
}): "active" | "pending" | "restricted" {
  if (input.chargesEnabled === true) return "active";
  if (input.detailsSubmitted === true) return "restricted";
  return "pending";
}

async function applySessionPaid(
  db: TenancyDb,
  event: StripeWebhookEvent,
  object: Record<string, unknown>,
  now: Date
): Promise<WebhookResult> {
  if (asString(object["object"]) !== "checkout.session") {
    return { outcome: "ignored", reason: "not_a_checkout_session" };
  }
  const metadata = asRecord(object["metadata"]);
  const orderId = metadata ? asString(metadata["orderId"]) : null;
  if (!orderId) return { outcome: "ignored", reason: "missing_order_metadata" };
  const accountId = event.account ?? null;
  if (!accountId) return { outcome: "ignored", reason: "missing_event_account" };

  const paymentAccount = await findPaymentAccount(db, accountId);
  if (!paymentAccount) return { outcome: "ignored", reason: "unknown_connected_account" };
  const order = await findOrder(db, orderId);
  if (!order) return { outcome: "ignored", reason: "unknown_order" };
  if (order.restaurantId !== paymentAccount.restaurantId) {
    return { outcome: "ignored", reason: "account_order_mismatch" };
  }
  if (!isPaymentStatus(order.paymentStatus)) {
    return { outcome: "ignored", reason: "unreadable_payment_status" };
  }
  if (!canTransitionPaymentStatus(order.paymentStatus, "paid")) {
    return {
      outcome: "ignored",
      reason: "transition_not_allowed",
      orderId,
      paymentStatus: order.paymentStatus,
    };
  }
  if (order.paymentStatus === "paid") {
    return { outcome: "applied", orderId, paymentStatus: "paid" };
  }
  const sessionId = asString(object["id"]);
  const updated = await setPaymentStatus(
    db,
    order,
    "paid",
    {
      paymentProvider: "stripe",
      paymentReference: sessionId,
      paymentIntentId: intentId(object["payment_intent"]),
      paidAt: now,
    },
    now
  );
  return { outcome: "applied", orderId, paymentStatus: updated.paymentStatus as PaymentStatus };
}

async function applySessionFailed(
  db: TenancyDb,
  event: StripeWebhookEvent,
  object: Record<string, unknown>,
  now: Date
): Promise<WebhookResult> {
  if (asString(object["object"]) !== "checkout.session") {
    return { outcome: "ignored", reason: "not_a_checkout_session" };
  }
  const metadata = asRecord(object["metadata"]);
  const orderId = metadata ? asString(metadata["orderId"]) : null;
  if (!orderId) return { outcome: "ignored", reason: "missing_order_metadata" };
  const accountId = event.account ?? null;
  if (!accountId) return { outcome: "ignored", reason: "missing_event_account" };

  const paymentAccount = await findPaymentAccount(db, accountId);
  if (!paymentAccount) return { outcome: "ignored", reason: "unknown_connected_account" };
  const order = await findOrder(db, orderId);
  if (!order) return { outcome: "ignored", reason: "unknown_order" };
  if (order.restaurantId !== paymentAccount.restaurantId) {
    return { outcome: "ignored", reason: "account_order_mismatch" };
  }
  if (!isPaymentStatus(order.paymentStatus)) {
    return { outcome: "ignored", reason: "unreadable_payment_status" };
  }
  if (order.paymentStatus === "failed") {
    return { outcome: "applied", orderId, paymentStatus: "failed" };
  }
  if (!canTransitionPaymentStatus(order.paymentStatus, "failed")) {
    return {
      outcome: "ignored",
      reason: "transition_not_allowed",
      orderId,
      paymentStatus: order.paymentStatus,
    };
  }
  const updated = await setPaymentStatus(db, order, "failed", {}, now);
  return { outcome: "applied", orderId, paymentStatus: updated.paymentStatus as PaymentStatus };
}

/**
 * Session expiry is the source of truth for abandoning a card ticket that
 * names a session: Stripe's own clock on the Checkout Session (30 minutes
 * from mint) kills it, never the board poll. Only a still-live `new`
 * ticket in an unpaid state is cancelled — a paid, refunded, or already
 * cancelled row is left alone, and the row is kept as the audit copy.
 */
async function applySessionExpired(
  db: TenancyDb,
  event: StripeWebhookEvent,
  object: Record<string, unknown>,
  now: Date
): Promise<WebhookResult> {
  if (asString(object["object"]) !== "checkout.session") {
    return { outcome: "ignored", reason: "not_a_checkout_session" };
  }
  const metadata = asRecord(object["metadata"]);
  const orderId = metadata ? asString(metadata["orderId"]) : null;
  if (!orderId) return { outcome: "ignored", reason: "missing_order_metadata" };
  const accountId = event.account ?? null;
  if (!accountId) return { outcome: "ignored", reason: "missing_event_account" };

  const paymentAccount = await findPaymentAccount(db, accountId);
  if (!paymentAccount) return { outcome: "ignored", reason: "unknown_connected_account" };
  const order = await findOrder(db, orderId);
  if (!order) return { outcome: "ignored", reason: "unknown_order" };
  if (order.restaurantId !== paymentAccount.restaurantId) {
    return { outcome: "ignored", reason: "account_order_mismatch" };
  }
  if (order.status !== "new") {
    return { outcome: "ignored", reason: "order_not_live", orderId };
  }
  if (!isPaymentStatus(order.paymentStatus)) {
    return { outcome: "ignored", reason: "unreadable_payment_status" };
  }
  if (order.paymentStatus === "paid" || order.paymentStatus === "refunded") {
    return {
      outcome: "ignored",
      reason: "transition_not_allowed",
      orderId,
      paymentStatus: order.paymentStatus,
    };
  }
  if (
    order.paymentStatus !== "unpaid" &&
    order.paymentStatus !== "pending" &&
    order.paymentStatus !== "failed"
  ) {
    return { outcome: "ignored", reason: "transition_not_allowed", orderId };
  }
  const updated = await db
    .update(orderTable)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(orderTable.id, order.id))
    .returning({ id: orderTable.id });
  if (updated.length === 0) return { outcome: "ignored", reason: "order_not_live", orderId };
  return { outcome: "applied", orderId, paymentStatus: order.paymentStatus };
}

async function applyChargeRefunded(
  db: TenancyDb,
  event: StripeWebhookEvent,
  object: Record<string, unknown>,
  now: Date
): Promise<WebhookResult> {
  if (asString(object["object"]) !== "charge") {
    return { outcome: "ignored", reason: "not_a_charge" };
  }
  const accountId = event.account ?? null;
  if (!accountId) return { outcome: "ignored", reason: "missing_event_account" };
  const paymentAccount = await findPaymentAccount(db, accountId);
  if (!paymentAccount) return { outcome: "ignored", reason: "unknown_connected_account" };

  const intent = intentId(object["payment_intent"]);
  if (!intent) return { outcome: "ignored", reason: "missing_payment_intent" };
  const rows = await db
    .select()
    .from(orderTable)
    .where(
      and(
        eq(orderTable.paymentIntentId, intent),
        eq(orderTable.restaurantId, paymentAccount.restaurantId)
      )
    )
    .limit(1);
  const order = rows[0] ?? null;
  if (!order) return { outcome: "ignored", reason: "unknown_payment_intent" };
  if (!isPaymentStatus(order.paymentStatus)) {
    return { outcome: "ignored", reason: "unreadable_payment_status" };
  }
  if (order.paymentStatus === "refunded") {
    return { outcome: "applied", orderId: order.id, paymentStatus: "refunded" };
  }
  // The one event allowed to move an order out of `paid`: the dashboard
  // refund agreed in Phase 0. Anything earlier stays put.
  if (!canTransitionPaymentStatus(order.paymentStatus, "refunded")) {
    return {
      outcome: "ignored",
      reason: "transition_not_allowed",
      orderId: order.id,
      paymentStatus: order.paymentStatus,
    };
  }
  const updated = await setPaymentStatus(db, order, "refunded", {}, now);
  return {
    outcome: "applied",
    orderId: order.id,
    paymentStatus: updated.paymentStatus as PaymentStatus,
  };
}

async function applyAccountUpdated(
  db: TenancyDb,
  event: StripeWebhookEvent,
  object: Record<string, unknown>,
  now: Date
): Promise<WebhookResult> {
  const accountId = event.account ?? asString(object["id"]);
  if (!accountId) return { outcome: "ignored", reason: "missing_event_account" };
  const paymentAccount = await findPaymentAccount(db, accountId);
  if (!paymentAccount) return { outcome: "ignored", reason: "unknown_connected_account" };

  const chargesEnabled =
    typeof object["charges_enabled"] === "boolean" ? object["charges_enabled"] : null;
  const payoutsEnabled =
    typeof object["payouts_enabled"] === "boolean" ? object["payouts_enabled"] : null;
  const detailsSubmitted =
    typeof object["details_submitted"] === "boolean" ? object["details_submitted"] : null;
  await db
    .update(restaurantPaymentAccount)
    .set({
      chargesEnabled: chargesEnabled ?? paymentAccount.chargesEnabled,
      payoutsEnabled: payoutsEnabled ?? paymentAccount.payoutsEnabled,
      detailsSubmitted: detailsSubmitted ?? paymentAccount.detailsSubmitted,
      status: mapAccountStatus({
        chargesEnabled: chargesEnabled ?? paymentAccount.chargesEnabled,
        payoutsEnabled: payoutsEnabled ?? paymentAccount.payoutsEnabled,
        detailsSubmitted: detailsSubmitted ?? paymentAccount.detailsSubmitted,
      }),
      statusCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(restaurantPaymentAccount.id, paymentAccount.id));
  return { outcome: "applied" };
}

/**
 * Apply one verified event. The replay row goes in first: a redelivery
 * inserts nothing (the id is the primary key) and is answered 200 without
 * touching the order again.
 */
export async function applyStripeWebhookEvent(
  db: TenancyDb,
  event: StripeWebhookEvent,
  now: Date = new Date()
): Promise<WebhookResult> {
  const object = asRecord(event.data.object) ?? {};

  // Order pairing for the guard row: sessions carry it in metadata, refunds
  // resolve it from the intent below, account syncs carry none.
  const metadata = asRecord(object["metadata"]);
  const metadataOrderId = metadata ? asString(metadata["orderId"]) : null;

  const inserted = await db
    .insert(stripeEventTable)
    .values({
      id: event.id,
      type: event.type,
      accountId: event.account ?? null,
      orderId: metadataOrderId,
    })
    .onConflictDoNothing({ target: stripeEventTable.id })
    .returning({ id: stripeEventTable.id });
  if (inserted.length === 0) return { outcome: "duplicate" };

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return applySessionPaid(db, event, object, now);
    case "checkout.session.async_payment_failed":
      return applySessionFailed(db, event, object, now);
    case "checkout.session.expired":
      return applySessionExpired(db, event, object, now);
    case "charge.refunded":
      return applyChargeRefunded(db, event, object, now);
    case "account.updated":
      return applyAccountUpdated(db, event, object, now);
    default:
      return { outcome: "ignored", reason: "unhandled_event_type" };
  }
}

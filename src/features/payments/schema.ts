import { z } from "zod";

/**
 * Card-payment state for a table order (Commit 2).
 *
 * Independent of the kitchen `status`: a ticket stays workable whether it
 * is unpaid, paid, or failed. The webhook is the only writer, and it only
 * moves forward — `paid` leaves only via `refunded` (dashboard refunds in
 * v1, which the board learns about here).
 */
export const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "failed", "refunded"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

/**
 * Forward-only payment transitions. A retry after a failure may still
 * succeed (`failed` → `paid`); a stale or redelivered event may never move
 * a paid order backwards — except the dashboard refund, which is the one
 * path out of `paid`.
 */
const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ["pending", "paid", "failed"],
  pending: ["paid", "failed"],
  paid: ["refunded"],
  // A failed attempt may be retried: back to pending for a fresh session,
  // then paid when the retry succeeds.
  failed: ["pending", "paid"],
  refunded: [],
};

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || ALLOWED_PAYMENT_TRANSITIONS[from].includes(to);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * The sliver of a Stripe event the webhook needs. Unknown provider fields
 * are stripped — only these are ever read, so a shape change elsewhere in
 * the payload cannot silently change behaviour.
 */
export const stripeWebhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  /** The connected account the event arrived for; absent on platform events. */
  account: z.string().min(1).nullable().optional(),
  data: z.object({
    object: z.record(z.string(), z.unknown()),
  }),
});

export type StripeWebhookEvent = z.infer<typeof stripeWebhookEventSchema>;

const PAYMENT_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "account.updated",
] as const;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

export function isPaymentEventType(type: string): type is PaymentEventType {
  return (PAYMENT_EVENT_TYPES as readonly string[]).includes(type);
}

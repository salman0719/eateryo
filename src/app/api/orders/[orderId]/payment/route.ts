import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { getPaymentAccount } from "@/features/payments/accounts";
import { getStripeSecret, retrieveCheckoutSession } from "@/features/payments/provider";
import { canTransitionPaymentStatus, isPaymentStatus } from "@/features/payments/schema";
import { fallbackCopy, resolveCheckout } from "@/features/payments/resolver";
import {
  consumeOrderRateLimit,
  getOrderByTrackingToken,
  isAwaitingExpired,
} from "@/features/orders/repo";
import { getDb } from "@/lib/db";
import { order as orderTable } from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { reportError } from "@/lib/observability/alerts";
import { requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/orders/[orderId]/payment — what the diner's receipt needs.
 *
 * Anonymous like the order itself: the tracking token is the only proof.
 * It never moves money. It answers the checkout decision (so no pay button
 * renders when the resolver says counter), the stored payment state, and —
 * when the return page passes `sessionId` — the live session read off the
 * café's account with `metadata.orderId` asserted, so a forged session id
 * for another order reads as unknown, never as paid.
 *
 * Paid-path writer: when that live read says paid for THIS order and the
 * stored state can move forward to paid, it applies the same transition the
 * webhook (or staff `payment-check`) would have — so the receipt poll heals
 * itself without a staff click. Expiry, failure and refund paths stay with
 * the webhook/sweep; a missed webhook for those still needs the board.
 */

const MAX_BODY_BYTES = 4 * 1024;

const bodySchema = z.object({
  trackingToken: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(128).nullable().optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function callerBucket(request: Request, now: Date): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const digest = createHash("sha256").update(`payread:${address}`).digest("hex").slice(0, 24);
  return `payread:${Math.floor(now.getTime() / 60_000)}:${digest}`;
}

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const requestId = requestIdFrom(request);
  const { orderId } = await params;
  if (!orderId) return errorResponse("not_found", "That order link is no longer valid.", 404);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse("payload_too_large", "That request is too large.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", "That order link is no longer valid.", 400);
  }

  const now = new Date();
  try {
    const limit = await consumeOrderRateLimit(getDb(), callerBucket(request, now), now);
    if (!limit.allowed) {
      const response = errorResponse(
        "rate_limited",
        "Too many tries from this connection. Wait a minute and try again.",
        429
      );
      response.headers.set("Retry-After", "60");
      return response;
    }

    const tracked = await getOrderByTrackingToken(getDb(), parsed.data.trackingToken, now);
    if (!tracked || tracked.id !== orderId) {
      return errorResponse("not_found", "That order link is no longer valid.", 404);
    }

    const db = getDb();
    const rows = await db.select().from(orderTable).where(eq(orderTable.id, orderId)).limit(1);
    const row = rows[0];
    if (!row) return errorResponse("not_found", "That order link is no longer valid.", 404);

    // Expired pay link — sessionless tickets only, swept here so the
    // receipt reads honest even if no staff board has polled since the TTL
    // lapsed. A ticket naming a session is never cancelled blind: the
    // webhook owns its expiry and `payment-check` owns its paid state.
    // The copy below is the whole story — no pay button renders on an
    // expired ticket.
    if (
      row.status === "new" &&
      row.paymentProvider === "stripe" &&
      !row.paymentReference &&
      (row.paymentStatus === "unpaid" ||
        row.paymentStatus === "pending" ||
        row.paymentStatus === "failed") &&
      isAwaitingExpired(row.createdAt, now)
    ) {
      await db
        .update(orderTable)
        .set({ status: "cancelled", updatedAt: now })
        .where(eq(orderTable.id, row.id));
      const expired = NextResponse.json({
        paymentStatus: row.paymentStatus,
        paymentProvider: row.paymentProvider,
        checkout: {
          mode: "at_venue",
          reason: "expired",
          copy: "This payment link expired after 30 minutes — place a new order or pay at the counter.",
        },
        live: null,
      });
      expired.headers.set("Cache-Control", "no-store");
      return expired;
    }
    if (row.status === "cancelled") {
      const gone = NextResponse.json({
        paymentStatus: row.paymentStatus,
        paymentProvider: row.paymentProvider,
        checkout: {
          mode: "at_venue",
          reason: "expired",
          copy: "This order was cleared — place a new order or pay at the counter.",
        },
        live: null,
      });
      gone.headers.set("Cache-Control", "no-store");
      return gone;
    }

    const paymentAccount = await getPaymentAccount(db, row.restaurantId);
    const decision = resolveCheckout({
      mode: paymentAccount?.mode ?? "at_venue",
      account: paymentAccount
        ? {
            status: paymentAccount.status,
            chargesEnabled: paymentAccount.chargesEnabled,
            currency: row.currency,
          }
        : null,
      order: { currency: row.currency, totalCents: row.totalCents },
    });

    // Optional live read for the Stripe return page. A session minted for a
    // different order reads as `live: null` — never as paid. Stripe failures
    // do the same; the stored state below stays the truth either way.
    let live: { paid: boolean; state: string } | null = null;
    let liveIntentId: string | null = null;
    if (parsed.data.sessionId && paymentAccount?.externalAccountId) {
      const secret = getStripeSecret();
      if (secret) {
        try {
          const session = await retrieveCheckoutSession(
            secret,
            paymentAccount.externalAccountId,
            parsed.data.sessionId
          );
          if (session.metadataOrderId === orderId) {
            live = {
              paid: session.paymentStatus === "paid",
              state: session.status ?? "unknown",
            };
            liveIntentId = session.paymentIntentId;
          }
        } catch (error) {
          await reportError("payments.session_verify_failed", error, { requestId, orderId });
          live = null;
        }
      }
    }

    // Self-heal: Stripe says paid for this order and the stored state can
    // move forward — apply it here so the receipt poll (and the board)
    // reads `paid` without waiting on the webhook or a staff click. The
    // metadata assertion above is the proof: only a session minted for this
    // order (minting already required the tracking token) can flip it, and
    // only forward into `paid`. The write itself is conditional on the
    // stored state still being payable, so a webhook refund (or a second
    // paid write) landing between our read and write can never be moved
    // backwards — the loser re-reads the winner. Already-paid rows are
    // never rewritten (no `paidAt` bump, no intent null-overwrite), and a
    // missing intent never clears a stored one. A failed write falls
    // through to stored + live so the next poll retries.
    let paymentStatus: string | null = row.paymentStatus;
    const from = row.paymentStatus ?? "unpaid";
    if (
      live?.paid &&
      from !== "paid" &&
      isPaymentStatus(from) &&
      canTransitionPaymentStatus(from, "paid")
    ) {
      try {
        const updated = await db
          .update(orderTable)
          .set({
            paymentStatus: "paid",
            paymentProvider: "stripe",
            paymentReference: parsed.data.sessionId ?? row.paymentReference,
            ...(liveIntentId ? { paymentIntentId: liveIntentId } : {}),
            paidAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(orderTable.id, row.id),
              or(
                isNull(orderTable.paymentStatus),
                inArray(orderTable.paymentStatus, ["unpaid", "pending", "failed"])
              )
            )
          )
          .returning();
        if (updated[0]) {
          paymentStatus = updated[0].paymentStatus;
        } else {
          const fresh = await db
            .select({ paymentStatus: orderTable.paymentStatus })
            .from(orderTable)
            .where(eq(orderTable.id, row.id))
            .limit(1);
          if (fresh[0]) paymentStatus = fresh[0].paymentStatus;
        }
      } catch (error) {
        await reportError("payments.payment_reconcile_failed", error, { requestId, orderId });
      }
    }

    const response = NextResponse.json({
      paymentStatus,
      paymentProvider: row.paymentProvider,
      checkout: {
        mode: decision.mode,
        reason: decision.reason,
        copy: fallbackCopy(decision.reason),
      },
      live,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await reportError("payments.payment_read_failed", error, { requestId, orderId });
    return errorResponse(
      "server_db_unavailable",
      "Could not load the payment state. Pay at the counter.",
      503
    );
  }
}

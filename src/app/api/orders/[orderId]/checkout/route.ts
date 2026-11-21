import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import {
  buildCheckoutLines,
  buildReturnUrls,
  CHECKOUT_TTL_SECONDS,
  isSessionReusable,
} from "@/features/payments/checkout";
import { getPaymentAccount } from "@/features/payments/accounts";
import {
  createCheckoutSession,
  getStripeSecret,
  retrieveCheckoutSession,
} from "@/features/payments/provider";
import { fallbackCopy, resolveCheckout } from "@/features/payments/resolver";
import { consumeOrderRateLimit, getOrderByTrackingToken } from "@/features/orders/repo";
import { getDb } from "@/lib/db";
import {
  order as orderTable,
  orderLine as orderLineTable,
  restaurant as restaurantTable,
} from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { reportError } from "@/lib/observability/alerts";
import { requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/orders/[orderId]/checkout — mint (or reuse) a Checkout Session.
 *
 * Anonymous by design: the diner proves the order with its tracking token
 * (issued at placement), never a session. The session is a direct charge on
 * the café's account (`Stripe-Account: acct_…`), 0% fee, paired by
 * `metadata[orderId]` for the webhook. One open session is reused per order
 * so closing Stripe's page twice cannot create two charges.
 */

const MAX_BODY_BYTES = 4 * 1024;

const bodySchema = z.object({
  trackingToken: z.string().min(1).max(256),
});

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function callerBucket(request: Request, now: Date): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const digest = createHash("sha256").update(`checkout:${address}`).digest("hex").slice(0, 24);
  return `checkout:${Math.floor(now.getTime() / 60_000)}:${digest}`;
}

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const requestId = requestIdFrom(request);
  const { orderId } = await params;
  if (!orderId) return errorResponse("invalid_body", "That order does not exist.", 404);

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

    // Bearer ownership: the tracking token issued at placement. Unknown,
    // expired, or mismatched tokens all answer the same generic 404.
    const tracked = await getOrderByTrackingToken(getDb(), parsed.data.trackingToken, now);
    if (!tracked || tracked.id !== orderId) {
      return errorResponse("not_found", "That order link is no longer valid.", 404);
    }

    const db = getDb();
    const orderRows = await db.select().from(orderTable).where(eq(orderTable.id, orderId)).limit(1);
    const row = orderRows[0];
    if (!row) return errorResponse("not_found", "That order link is no longer valid.", 404);
    if (row.paymentStatus === "paid" || row.paymentStatus === "refunded") {
      return errorResponse("already_paid", "This order is already paid.", 409);
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
    if (decision.mode !== "online") {
      return errorResponse("pay_unavailable", fallbackCopy(decision.reason), 409, {
        reason: decision.reason,
      });
    }
    if (!paymentAccount?.externalAccountId) {
      return errorResponse("pay_unavailable", fallbackCopy("not_connected"), 409, {
        reason: "not_connected",
      });
    }

    const lineRows = await db
      .select()
      .from(orderLineTable)
      .where(eq(orderLineTable.orderId, orderId));
    const built = buildCheckoutLines({
      id: row.id,
      currency: row.currency,
      totalCents: row.totalCents,
      lines: lineRows.map((line) => ({
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
      })),
    });
    if (built.error || built.lines.length === 0) {
      return errorResponse("pay_unavailable", fallbackCopy("unpriced_lines"), 409, {
        reason: built.error ?? "unpriced_lines",
      });
    }

    const restaurantRows = await db
      .select({ slug: restaurantTable.slug })
      .from(restaurantTable)
      .where(eq(restaurantTable.id, row.restaurantId))
      .limit(1);
    const restaurantSlug = restaurantRows[0]?.slug;
    if (!restaurantSlug) {
      return errorResponse("pay_unavailable", fallbackCopy("not_connected"), 409, {
        reason: "not_connected",
      });
    }

    const secret = getStripeSecret();
    if (!secret) {
      return errorResponse(
        "server_db_unavailable",
        "Card payment is unavailable right now. Pay at the counter.",
        503
      );
    }

    const accountId = paymentAccount.externalAccountId;
    const nowUnix = Math.floor(now.getTime() / 1000);

    // Reuse the open session: the diner closing Stripe's page twice (or
    // double-tapping pay) lands on the same URL, never two charges.
    if (row.paymentReference) {
      try {
        const existing = await retrieveCheckoutSession(secret, accountId, row.paymentReference);
        if (isSessionReusable(existing, nowUnix) && existing.url) {
          const response = NextResponse.json({
            url: existing.url,
            sessionId: existing.id,
            reused: true,
          });
          response.headers.set("Cache-Control", "no-store");
          return response;
        }
      } catch (error) {
        // A deleted or expired session falls through to a fresh one; a
        // transport failure is still a 503 below only when creation fails.
        await reportError("payments.session_reuse_failed", error, { requestId, orderId });
      }
    }

    const origin = new URL(request.url).origin;
    const urls = buildReturnUrls({
      origin,
      restaurantSlug,
      tableLabel: row.tableLabel,
      trackingToken: parsed.data.trackingToken,
    });

    let session: Awaited<ReturnType<typeof createCheckoutSession>>;
    try {
      session = await createCheckoutSession(
        secret,
        {
          accountId,
          orderId: row.id,
          currency: "AUD",
          lines: built.lines,
          successUrl: urls.successUrl,
          cancelUrl: urls.cancelUrl,
          expiresAtUnix: nowUnix + CHECKOUT_TTL_SECONDS,
        },
        { idempotencyKey: `checkout-${row.id}-${row.updatedAt.getTime()}` }
      );
    } catch (error) {
      await reportError("payments.checkout_create_failed", error, { requestId, orderId });
      return errorResponse(
        "server_db_unavailable",
        "Card payment is unavailable right now. Pay at the counter.",
        503
      );
    }
    if (!session.url) {
      return errorResponse(
        "server_db_unavailable",
        "Card payment is unavailable right now. Pay at the counter.",
        503
      );
    }

    await db
      .update(orderTable)
      .set({
        paymentStatus: "pending",
        paymentProvider: "stripe",
        paymentReference: session.id,
        updatedAt: now,
      })
      .where(eq(orderTable.id, row.id));

    const response = NextResponse.json({ url: session.url, sessionId: session.id, reused: false });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await reportError("payments.checkout_failed", error, { requestId, orderId });
    return errorResponse(
      "server_db_unavailable",
      "Card payment is unavailable right now. Pay at the counter.",
      503
    );
  }
}

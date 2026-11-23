import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getPaymentAccount } from "@/features/payments/accounts";
import { getStripeSecret, retrieveCheckoutSession } from "@/features/payments/provider";
import { canTransitionPaymentStatus } from "@/features/payments/schema";
import { getOrderForStaff } from "@/features/orders/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { order as orderTable } from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { reportError } from "@/lib/observability/alerts";
import { requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/orders/[orderId]/payment-check — staff reconciliation.
 *
 * For the missed-webhook case: reads the order's Checkout Session directly
 * off the café's account and, when Stripe says paid, applies the same
 * forward-only transition the webhook would have. Anything else leaves the
 * order untouched and reports the stored state. Member of the restaurant
 * only; cross-tenant ids answer 404 so they cannot be probed.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const requestId = requestIdFrom(request);
  const { orderId } = await params;
  if (!orderId) return errorResponse("not_found", "That order does not exist.", 404);

  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
  if (!userId) return errorResponse("unauthorized", "Sign in to continue.", 401);

  try {
    const db = getDb();
    const order = await getOrderForStaff(db, userId, orderId);
    if (!order) return errorResponse("not_found", "That order does not exist.", 404);

    const rows = await db.select().from(orderTable).where(eq(orderTable.id, orderId)).limit(1);
    const row = rows[0];
    if (!row) return errorResponse("not_found", "That order does not exist.", 404);
    if (!row.paymentReference) {
      return errorResponse("no_session", "This order has no card payment to check.", 409);
    }
    if (row.paymentStatus === "paid" || row.paymentStatus === "refunded") {
      return noStore(NextResponse.json({ paymentStatus: row.paymentStatus, reconciled: false }));
    }

    const paymentAccount = await getPaymentAccount(db, row.restaurantId);
    if (!paymentAccount?.externalAccountId) {
      return errorResponse("no_session", "This order has no card payment to check.", 409);
    }
    const secret = getStripeSecret();
    if (!secret) {
      return errorResponse("server_db_unavailable", "Could not reach Stripe. Try again.", 503);
    }

    let paid: boolean;
    let intent: string | null;
    try {
      const session = await retrieveCheckoutSession(
        secret,
        paymentAccount.externalAccountId,
        row.paymentReference
      );
      if (session.metadataOrderId !== orderId) {
        return errorResponse("not_found", "That order does not exist.", 404);
      }
      paid = session.paymentStatus === "paid";
      intent = session.paymentIntentId;
    } catch (error) {
      await reportError("payments.payment_check_failed", error, { requestId, orderId });
      return errorResponse("server_db_unavailable", "Could not reach Stripe. Try again.", 503);
    }

    if (!paid) {
      return noStore(NextResponse.json({ paymentStatus: row.paymentStatus, reconciled: false }));
    }
    if (!canTransitionPaymentStatus(row.paymentStatus, "paid")) {
      return noStore(NextResponse.json({ paymentStatus: row.paymentStatus, reconciled: false }));
    }

    const now = new Date();
    await db
      .update(orderTable)
      .set({
        paymentStatus: "paid",
        paymentProvider: "stripe",
        paymentIntentId: intent,
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(orderTable.id, orderId));

    return noStore(NextResponse.json({ paymentStatus: "paid", reconciled: true }));
  } catch (error) {
    await reportError("payments.payment_check_failed", error, { requestId, orderId });
    return errorResponse("server_db_unavailable", "Could not check the payment. Try again.", 503);
  }
}

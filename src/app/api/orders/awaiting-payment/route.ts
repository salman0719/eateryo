import { NextResponse } from "next/server";

import { listAwaitingPaymentForStaff, OrderRepoError } from "@/features/orders/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";
import { requestIdFrom } from "@/lib/observability/log";

/**
 * GET /api/orders/awaiting-payment — the slim strip above the Kanban.
 *
 * Card tickets the board hides (Option A): `payment_provider = 'stripe'`
 * while unpaid/pending/failed. Paid rows never appear here — the board
 * already shows them. Session required, member of the restaurant only.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const userId = await getSessionUserId()
    .then((id) => id ?? errorResponse("unauthorized", "Sign in to continue.", 401))
    .catch(() =>
      errorResponse(
        "server_db_unavailable",
        "Server sync is not available yet — keep working locally.",
        503
      )
    );
  if (userId instanceof NextResponse) return userId;

  const url = new URL(request.url);
  try {
    const result = await listAwaitingPaymentForStaff(getDb(), userId, {
      restaurantId: url.searchParams.get("restaurantId"),
    });
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) {
      if (error.code === "not_found") return errorResponse("not_found", error.message, 404);
      return errorResponse("invalid_body", error.message, 400);
    }
    await reportError("orders.awaiting_payment_failed", error, {
      requestId: requestIdFrom(request),
    });
    return errorResponse("server_db_unavailable", "Could not load awaiting payments.", 503);
  }
}

import { NextResponse } from "next/server";

import { countOrdersForStaff, OrderRepoError } from "@/features/orders/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";
import { requestIdFrom } from "@/lib/observability/log";

/**
 * GET /api/orders/counts — staff board totals (session required). One
 * `COUNT(*) GROUP BY status` over the same restaurant + window scope as the
 * history pages, so the header can show the full total without loading a
 * single ticket. Lines are never read here.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapRepoError(error: OrderRepoError): NextResponse {
  switch (error.code) {
    case "not_found":
      return errorResponse("not_found", error.message, 404);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "invalid":
    default:
      return errorResponse("invalid_body", error.message, 400);
  }
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
    const result = await countOrdersForStaff(getDb(), userId, {
      restaurantId: url.searchParams.get("restaurantId"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) return mapRepoError(error);
    await reportError("orders.counts_failed", error, {
      requestId: requestIdFrom(request),
    });
    return errorResponse("server_db_unavailable", "Could not load order totals. Try again.", 503);
  }
}

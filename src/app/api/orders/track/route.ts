import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import {
  consumeOrderRateLimit,
  getOrderByTrackingToken,
  OrderRepoError,
  TRACK_RATE_LIMIT_PER_WINDOW,
} from "@/features/orders/repo";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * GET /api/orders/track?token=<token> — public diner status read (tracking v1).
 *
 * Token-scoped and read-only: the bearer token resolves to exactly one order.
 * Unknown, expired, or terminally-old tokens all answer one generic 404, so
 * the response never reveals whether an order exists. No PII beyond what the
 * order itself carries, `no-store` always, and the token is never logged.
 *
 * Rate limit lives in its own bucket (`track:`) — polling must never eat the
 * POST 12/min placement allowance.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function callerBucket(request: Request, now: Date): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const digest = createHash("sha256").update(address).digest("hex").slice(0, 24);
  return `track:${Math.floor(now.getTime() / 60_000)}:${digest}`;
}

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const now = new Date();
  try {
    const limit = await consumeOrderRateLimit(
      getDb(),
      callerBucket(request, now),
      now,
      TRACK_RATE_LIMIT_PER_WINDOW
    );
    if (!limit.allowed) {
      logEvent("warn", "orders.track_rate_limited", { requestId, count: limit.count });
      const response = errorResponse(
        "rate_limited",
        "Too many status checks. Wait a minute and try again.",
        429
      );
      response.headers.set("Retry-After", "60");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token.trim() || token.length > 256) {
      const response = errorResponse(
        "not_found",
        "That order link is not valid. Ask staff to check your order.",
        404
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const order = await getOrderByTrackingToken(getDb(), token, now);
    if (!order) {
      const response = errorResponse(
        "not_found",
        "That order link is not valid. Ask staff to check your order.",
        404
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const response = NextResponse.json({ order, serverTime: now.toISOString() });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) {
      const response = errorResponse(
        "not_found",
        "That order link is not valid. Ask staff to check your order.",
        404
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    await reportError("orders.track_failed", error, { requestId });
    const response = errorResponse(
      "server_db_unavailable",
      "Could not check the order. Try again.",
      503
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

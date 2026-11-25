import { NextResponse } from "next/server";

import { applyStripeWebhookEvent } from "@/features/payments/repo";
import { isPaymentEventType, stripeWebhookEventSchema } from "@/features/payments/schema";
import { verifyStripeSignature } from "@/features/payments/verify";
import { getDb } from "@/lib/db";
import { logEvent, requestIdFrom } from "@/lib/observability/log";
import { reportError } from "@/lib/observability/alerts";

/**
 * POST /api/stripe/webhook — Connect webhook endpoint (Commit 2).
 *
 * Stripe posts here server-to-server, so this route deliberately skips the
 * same-origin guard every other mutation uses: a cross-site `Origin` is
 * expected, and the signature — not the origin — is the credential. There
 * is no session (Stripe holds no cookie) and no provider detail in any
 * response body.
 *
 * Signature failures answer 400 (Stripe will retry, then dead-letter —
 * logged for the operator). Unknown event types, replays, and events that
 * authorise against nothing answer 200: a 4xx would retry something that
 * will never succeed. Only a transient server failure answers 503, which is
 * the one case where a retry helps.
 *
 * Payloads are small event envelopes; anything over the cap is refused
 * before parsing.
 */

const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logEvent("error", "stripe.webhook_not_configured", { requestId });
    return errorResponse("webhook_not_configured", "Card payments are not configured yet.", 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse("payload_too_large", "That event is too large.", 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse("invalid_body", "Could not read the event.", 400);
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorResponse("payload_too_large", "That event is too large.", 413);
  }

  const signature = request.headers.get("stripe-signature");
  const check = verifyStripeSignature(rawBody, signature, secret);
  if (!check.ok) {
    logEvent("warn", "stripe.webhook_bad_signature", { requestId, failure: check.failure });
    return errorResponse("invalid_signature", "That event could not be verified.", 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorResponse("invalid_body", "That event is not valid JSON.", 400);
  }
  const parsed = stripeWebhookEventSchema.safeParse(payload);
  if (!parsed.success) {
    logEvent("warn", "stripe.webhook_bad_envelope", { requestId });
    return errorResponse("invalid_body", "That event has an unknown shape.", 400);
  }
  const event = parsed.data;

  try {
    const result = await applyStripeWebhookEvent(getDb(), event);
    if (result.outcome === "ignored") {
      // 200 on purpose: nothing about a retry would change the answer, and
      // the log line is the operator's trail.
      logEvent("warn", "stripe.webhook_ignored", {
        requestId,
        eventId: event.id,
        eventType: isPaymentEventType(event.type) ? event.type : "unhandled",
        reason: result.reason ?? "unknown",
        orderId: result.orderId ?? null,
      });
    } else {
      logEvent("info", "stripe.webhook_received", {
        requestId,
        eventId: event.id,
        eventType: isPaymentEventType(event.type) ? event.type : "unhandled",
        outcome: result.outcome,
        orderId: result.orderId ?? null,
        paymentStatus: result.paymentStatus ?? null,
      });
    }
    const response = NextResponse.json(
      {
        received: true,
        outcome: result.outcome,
        ...(result.orderId ? { orderId: result.orderId } : {}),
        ...(result.paymentStatus ? { paymentStatus: result.paymentStatus } : {}),
      },
      { status: 200 }
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Transient (usually the DB): a non-2xx makes Stripe redeliver, and the
    // replay guard makes the redelivery safe.
    await reportError("stripe.webhook_failed", error, { requestId, eventId: event.id });
    return errorResponse("server_db_unavailable", "Could not record the event. Try again.", 503);
  }
}

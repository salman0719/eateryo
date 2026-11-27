import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { findPasswordUserId } from "@/lib/auth/lockout";
import { sendPasswordResetEmail } from "@/lib/auth/email";
import { mintPasswordResetToken } from "@/lib/auth/reset-tokens";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logEvent } from "@/lib/observability/log";
import { consumeOrderRateLimit } from "@/features/orders/repo";

/**
 * POST /api/password/forgot — self-serve password reset request (P5).
 *
 * Always answers 200 with the same body, whether the address names an
 * account with a password, a link-only account, or nobody at all (plan
 * Q1): the screen can promise "if that address can reset, a link is on
 * its way" without oracling which addresses exist. Only an account that
 * can sign in with a password is emailed; a mistyped address costs one
 * rate-limit bucket, never a counter row or an email.
 *
 * A send failure is logged and still answered 200 — a 503 only for
 * accounts that exist would be the oracle by another name. Error shape:
 * { error: { code, message } }, no-store, like every other auth route.
 */

const bodySchema = z.object({ email: z.string().min(1).max(254) });

/** The one copy the screen shows, whatever the address named. */
export const FORGOT_RESPONSE_COPY = "If that address can reset, a link is on its way.";

function errorResponse(code: string, message: string, status: number): NextResponse {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * One-way bucket id for the rate limiter: the caller's address is hashed
 * with the current minute, so no raw IP is stored and every window starts
 * fresh — the same shape as the order endpoint's bucket, with its own
 * prefix so reset requests never eat the ordering budget.
 */
function forgotBucket(request: Request, now: Date): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const digest = createHash("sha256").update(address).digest("hex").slice(0, 24);
  return `forgot:${Math.floor(now.getTime() / 60_000)}:${digest}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", 'Send { "email" }.', 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", 'Send { "email" }.', 400);
  }

  const db = getDb();
  const now = new Date();
  try {
    const limit = await consumeOrderRateLimit(db, forgotBucket(request, now), now);
    if (!limit.allowed) {
      logEvent("warn", "auth.password_reset_rate_limited", { count: limit.count });
      const response = errorResponse(
        "rate_limited",
        "Too many reset requests from this connection. Wait a minute and try again.",
        429
      );
      response.headers.set("Retry-After", "60");
      return response;
    }
  } catch (error) {
    logEvent("error", "auth.password_reset_rate_limit_failed", { error });
    return errorResponse(
      "server_db_unavailable",
      "Password reset is not available yet — try again.",
      503
    );
  }

  let userId: string | null;
  try {
    userId = await findPasswordUserId(db, parsed.data.email);
  } catch (error) {
    logEvent("error", "auth.password_reset_read_failed", { error });
    return errorResponse(
      "server_db_unavailable",
      "Password reset is not available yet — try again.",
      503
    );
  }

  if (userId) {
    try {
      const { token } = await mintPasswordResetToken(db, userId);
      const url = new URL("/sign-in/reset", request.url);
      url.searchParams.set("token", token);
      await sendPasswordResetEmail({ email: parsed.data.email.trim(), url: url.toString() });
    } catch (error) {
      // Answered 200 below regardless: the address must never learn
      // whether it named an account from our status codes.
      logEvent("error", "auth.password_reset_send_failed", { error });
    }
  }

  const response = NextResponse.json({ requested: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

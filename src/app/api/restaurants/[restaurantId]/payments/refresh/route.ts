import { NextResponse } from "next/server";

import { getPaymentAccountForMember } from "@/features/payments/accounts";
import { createAccountLink, getStripeSecret } from "@/features/payments/provider";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST …/payments/refresh — owner-only. Mints a fresh onboarding link for
 * the already-linked account (expired link, browser back, abandoned
 * onboarding). Creates nothing: abandoning onboarding and returning still
 * shows pending, never connected.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

type RouteParams = { params: Promise<{ restaurantId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  let userId: string | null = null;
  try {
    userId = await getSessionUserId();
  } catch {
    return errorResponse("server_db_unavailable", "Server sync is not available yet.", 503);
  }
  if (!userId) return errorResponse("unauthorized", "Sign in to continue.", 401);
  const { restaurantId } = await params;

  const secret = getStripeSecret();
  if (!secret)
    return errorResponse("payments_not_configured", "Card payments are not configured yet.", 503);

  try {
    const member = await getRestaurantForUser(getDb(), userId, restaurantId);
    if (!member) return errorResponse("not_found", "That restaurant does not exist.", 404);
    if (member.role !== "owner") {
      return errorResponse("forbidden", "Only an owner can reconnect card payments.", 403);
    }
    const account = await getPaymentAccountForMember(getDb(), userId, restaurantId);
    if (!account) {
      return errorResponse("not_connected", "Connect Stripe first, then refresh the link.", 409);
    }
    const origin = new URL(request.url).origin;
    const { url, expiresAt } = await createAccountLink(secret, {
      accountId: account.externalAccountId,
      returnUrl: `${origin}/settings?payments=return&restaurant=${encodeURIComponent(restaurantId)}`,
      refreshUrl: `${origin}/settings?payments=refresh&restaurant=${encodeURIComponent(restaurantId)}`,
    });
    return noStore(NextResponse.json({ url, expiresAt }));
  } catch {
    return errorResponse(
      "provider_unavailable",
      "Stripe could not refresh the link. Try again.",
      503
    );
  }
}

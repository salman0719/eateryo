import { NextResponse } from "next/server";

import {
  getPaymentAccountForMember,
  linkPaymentAccountForOwner,
} from "@/features/payments/accounts";
import {
  createAccountLink,
  createCoreAccount,
  getStripeSecret,
} from "@/features/payments/provider";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { AccountStateError, assertAccountActive } from "@/lib/auth/account-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST …/payments/connect — owner-only. Finds (or creates) the café's
 * Connect account, then mints a fresh onboarding link every time.
 * Pressing connect twice yields one `acct_`: creation is idempotent per
 * restaurant and the row is unique per (restaurant, provider).
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
  if (!secret) {
    return errorResponse("payments_not_configured", "Card payments are not configured yet.", 503);
  }

  try {
    await assertAccountActive(getDb(), userId);
    const member = await getRestaurantForUser(getDb(), userId, restaurantId);
    if (!member) return errorResponse("not_found", "That restaurant does not exist.", 404);
    if (member.role !== "owner") {
      return errorResponse("forbidden", "Only an owner can connect card payments.", 403);
    }

    const existing = await getPaymentAccountForMember(getDb(), userId, restaurantId);
    let externalAccountId = existing?.externalAccountId ?? null;
    let livemode = existing?.livemode ?? process.env.NODE_ENV === "production";
    if (!externalAccountId) {
      const created = await createCoreAccount(
        secret,
        { country: "AU" },
        { idempotencyKey: `eateryo-connect-${restaurantId}` }
      );
      externalAccountId = created.id;
      livemode = created.livemode;
      await linkPaymentAccountForOwner(getDb(), userId, restaurantId, {
        externalAccountId,
        livemode,
      });
    }

    const origin = new URL(request.url).origin;
    const { url, expiresAt } = await createAccountLink(secret, {
      accountId: externalAccountId,
      returnUrl: `${origin}/settings?payments=return&restaurant=${encodeURIComponent(restaurantId)}`,
      refreshUrl: `${origin}/settings?payments=refresh&restaurant=${encodeURIComponent(restaurantId)}`,
    });
    return noStore(NextResponse.json({ url, expiresAt }));
  } catch (error) {
    if (error instanceof AccountStateError)
      return errorResponse("account_suspended", error.message, 403);
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("live_key_outside_production") || message.includes("stripe_")) {
      return errorResponse(
        "provider_unavailable",
        "Stripe could not start onboarding. Try again.",
        503
      );
    }
    return errorResponse("server_db_unavailable", "Could not start the Stripe connection.", 503);
  }
}

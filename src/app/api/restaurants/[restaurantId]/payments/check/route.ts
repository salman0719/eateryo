import { NextResponse } from "next/server";

import { getPaymentAccountForMember, syncPaymentAccountStatus } from "@/features/payments/accounts";
import { getStripeSecret, retrieveAccountStatus } from "@/features/payments/provider";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { AccountStateError, assertAccountActive } from "@/lib/auth/account-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST …/payments/check — "Check again". Any member may read the result;
 * only an owner triggers the Stripe read (staff see the cached status).
 * Reads Stripe rather than the cache, so a completed onboarding or a
 * revoked capability shows up without waiting for the webhook.
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
    await assertAccountActive(getDb(), userId);
    const member = await getRestaurantForUser(getDb(), userId, restaurantId);
    if (!member) return errorResponse("not_found", "That restaurant does not exist.", 404);
    if (member.role !== "owner") {
      return errorResponse("forbidden", "Only an owner can check with Stripe.", 403);
    }
    const account = await getPaymentAccountForMember(getDb(), userId, restaurantId);
    if (!account) return noStore(NextResponse.json({ account: null }));

    let read;
    try {
      read = await retrieveAccountStatus(secret, account.externalAccountId);
    } catch {
      return errorResponse("provider_unavailable", "Stripe could not be reached. Try again.", 503);
    }
    const updated = await syncPaymentAccountStatus(getDb(), account.id, read);
    if (!updated)
      return errorResponse("server_db_unavailable", "Could not save the Stripe answer.", 503);
    return noStore(
      NextResponse.json({
        account: {
          id: updated.id,
          provider: updated.provider,
          mode: updated.mode,
          livemode: updated.livemode,
          externalAccountId: updated.externalAccountId,
          status: updated.status,
          chargesEnabled: updated.chargesEnabled,
          payoutsEnabled: updated.payoutsEnabled,
          detailsSubmitted: updated.detailsSubmitted,
          country: updated.country,
          defaultCurrency: updated.defaultCurrency,
          requirementCodes: updated.requirementCodes,
          connectedAt: updated.connectedAt?.toISOString() ?? null,
          statusCheckedAt: updated.statusCheckedAt?.toISOString() ?? null,
        },
      })
    );
  } catch (error) {
    if (error instanceof AccountStateError)
      return errorResponse("account_suspended", error.message, 403);
    return errorResponse("server_db_unavailable", "Could not check with Stripe.", 503);
  }
}

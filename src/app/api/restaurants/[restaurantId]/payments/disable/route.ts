import { NextResponse } from "next/server";

import {
  disableOnlinePaymentsForOwner,
  getPaymentAccountForMember,
} from "@/features/payments/accounts";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST …/payments/disable — owner-only "Turn off". Back to
 * pay-at-the-counter; the Stripe connection is kept, so turning it back on
 * needs no second onboarding. There is no hard disconnect in v1.
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

  try {
    const member = await getRestaurantForUser(getDb(), userId, restaurantId);
    if (!member) return errorResponse("not_found", "That restaurant does not exist.", 404);
    if (member.role !== "owner") {
      return errorResponse("forbidden", "Only an owner can turn card payment off.", 403);
    }
    const current = await getPaymentAccountForMember(getDb(), userId, restaurantId);
    if (!current) return noStore(NextResponse.json({ account: null }));
    const updated = await disableOnlinePaymentsForOwner(getDb(), userId, restaurantId);
    if (!updated)
      return errorResponse("server_db_unavailable", "Could not turn card payment off.", 503);
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
  } catch {
    return errorResponse("server_db_unavailable", "Could not turn card payment off.", 503);
  }
}

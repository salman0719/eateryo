import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getLiveMenuCurrencyWarnings,
  getPaymentAccountForMember,
  setPaymentModeForOwner,
} from "@/features/payments/accounts";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET  /api/restaurants/[restaurantId]/payments — status any member may read.
 * PATCH …/payments { mode } — owner-only switch (`online` | `at_venue`).
 * Anonymous visitors get 401 with no provider detail; outsiders get 404 so
 * ids cannot be probed across tenants. Responses are `no-store`: payment
 * state must never sit in a cache. Error shape: { error: { code, message } }.
 */

const modeBody = z.object({ mode: z.enum(["online", "at_venue"]) });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function requireUser(): Promise<string | NextResponse> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return errorResponse("unauthorized", "Sign in to continue.", 401);
    return userId;
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
}

async function refusalResponse(
  userId: string,
  restaurantId: string,
  memberMessage: string
): Promise<NextResponse> {
  const member = await getRestaurantForUser(getDb(), userId, restaurantId);
  return member
    ? errorResponse("forbidden", memberMessage, 403)
    : errorResponse("not_found", "That restaurant does not exist.", 404);
}

function serialize(
  account: NonNullable<Awaited<ReturnType<typeof getPaymentAccountForMember>>>,
  currencyWarnings: Awaited<ReturnType<typeof getLiveMenuCurrencyWarnings>>
) {
  return {
    id: account.id,
    provider: account.provider,
    mode: account.mode,
    livemode: account.livemode,
    externalAccountId: account.externalAccountId,
    status: account.status,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted,
    country: account.country,
    defaultCurrency: account.defaultCurrency,
    requirementCodes: account.requirementCodes,
    connectedAt: account.connectedAt?.toISOString() ?? null,
    statusCheckedAt: account.statusCheckedAt?.toISOString() ?? null,
    currencyWarnings,
  };
}

type RouteParams = { params: Promise<{ restaurantId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  try {
    const account = await getPaymentAccountForMember(getDb(), userId, restaurantId);
    if (account === null) {
      const member = await getRestaurantForUser(getDb(), userId, restaurantId);
      if (!member) return errorResponse("not_found", "That restaurant does not exist.", 404);
      return noStore(NextResponse.json({ account: null }));
    }
    const currencyWarnings = await getLiveMenuCurrencyWarnings(getDb(), userId, restaurantId);
    return noStore(NextResponse.json({ account: serialize(account, currencyWarnings) }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not load card payments.", 503);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = modeBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", "Choose online or pay-at-the-counter.", 400);
  }

  try {
    // Online needs a real connection; the counter is always allowed.
    if (parsed.data.mode === "online") {
      const current = await getPaymentAccountForMember(getDb(), userId, restaurantId);
      if (!current) {
        return refusalResponse(
          userId,
          restaurantId,
          "Connect Stripe before turning card payment on."
        );
      }
      if (current.status !== "active" || !current.chargesEnabled) {
        return errorResponse(
          "provider_not_ready",
          "Stripe says this account cannot charge yet — finish setup first.",
          409
        );
      }
    }
    const updated = await setPaymentModeForOwner(getDb(), userId, restaurantId, parsed.data.mode);
    if (!updated) {
      return refusalResponse(userId, restaurantId, "Only an owner can change card payments.");
    }
    const currencyWarnings = await getLiveMenuCurrencyWarnings(getDb(), userId, restaurantId);
    return noStore(NextResponse.json({ account: serialize(updated, currencyWarnings) }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not change the payment mode.", 503);
  }
}

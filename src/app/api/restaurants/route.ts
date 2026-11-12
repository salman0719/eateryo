import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createRestaurant,
  getOwnedRestaurantForUser,
  listRestaurantsForUser,
} from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET  /api/restaurants — the signed-in user's restaurants (with their role),
 *   and `accountId`: whose list this is. The shell starts this read with the
 *   session read (both are gated by the same cookie), so the answer can
 *   arrive before the client knows which account asked; naming the account
 *   lets it file the answer without a second round trip. The id is the
 *   caller's own, already known to their client from the session — it tells
 *   them nothing they could not read there, and no other account's id.
 * POST /api/restaurants — create one; the caller becomes its owner. An
 *   account may own at most one restaurant (006), so an owner gets 409
 *   `restaurant_exists` instead of a second café. Staff memberships in other
 *   cafés never block creating your own.
 * Anonymous visitors get 401; a missing server DB gets 503 (the local-only
 * mode is unaffected — this endpoint is simply unused when signed out).
 * Error shape matches the extraction route: { error: { code, message } }.
 */

const createBody = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Session guard shared by both handlers. */
async function requireUser(): Promise<string | NextResponse> {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return errorResponse("unauthorized", "Sign in to continue.", 401);
    }
    return userId;
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
}

export async function GET() {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const restaurants = await listRestaurantsForUser(getDb(), userId);
    const response = NextResponse.json({ restaurants, accountId: userId });
    // Personalized data must never be cached.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorResponse("server_db_unavailable", "Could not load restaurants. Try again.", 503);
  }
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = createBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const db = getDb();
    // The forms only render while the account owns nothing, so this closes
    // the raw endpoint and any stale-state double submit rather than a
    // visible path. The check and the insert are separate statements (the
    // Neon HTTP driver has no interactive transactions); a duplicated
    // restaurant is a nuisance the owner can delete, never a leak.
    if (await getOwnedRestaurantForUser(db, userId)) {
      return errorResponse(
        "restaurant_exists",
        "You already have a restaurant on this account.",
        409
      );
    }
    const restaurant = await createRestaurant(db, userId, parsed.data.name);
    return NextResponse.json({ restaurant }, { status: 201 });
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Could not create the restaurant. Try again.",
      503
    );
  }
}

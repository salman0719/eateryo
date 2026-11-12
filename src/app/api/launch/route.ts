import { NextResponse } from "next/server";

import { readLaunchStatus } from "@/features/launch/repo";
import { listRestaurantsForUser } from "@/features/tenancy/repo";
import { hasCapability } from "@/features/tenancy/permissions";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";

/**
 * GET /api/launch?restaurantId=… — one café's onboarding state: how many of
 * its menus exist, whether one is live, how many of its orders have arrived,
 * what still needs a price, and this month's extraction + assistant spend
 * against the account's caps.
 *
 * One membership at a time: the caller names the café it is acting in, and the
 * answer never mixes in another membership's menus or orders. One request
 * feeds the whole checklist; personalized, so never cached.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "server_db_unavailable",
          message: "Server data is not available yet — keep working locally.",
        },
      },
      { status: 503 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to see your launch checklist." } },
      { status: 401 }
    );
  }

  const restaurantId = new URL(request.url).searchParams.get("restaurantId")?.trim() ?? "";
  if (!restaurantId) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: "Choose the café whose checklist you want to see.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    // The checklist is the owner's onboarding: extract, review, publish,
    // print. A staff member cannot do those things, so that membership gets a
    // refusal rather than a list of steps it must not take. A café on another
    // account is a 404, never a hint that it exists.
    const memberships = await listRestaurantsForUser(db, userId);
    const membership = memberships.find((row) => row.id === restaurantId);
    if (!membership) {
      return NextResponse.json(
        {
          error: { code: "not_found", message: "That café is not on this account." },
        },
        { status: 404 }
      );
    }
    if (!hasCapability(membership.access.capabilities, "settings.manage")) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "The launch checklist belongs to the café you are acting in as its owner.",
          },
        },
        { status: 403 }
      );
    }
    const response = NextResponse.json({
      launch: await readLaunchStatus(db, userId, restaurantId),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await reportError("launch.status_failed", error);
    return NextResponse.json(
      { error: { code: "server_db_unavailable", message: "Could not load your checklist." } },
      { status: 503 }
    );
  }
}

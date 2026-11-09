import { NextResponse } from "next/server";

import { readLaunchStatus } from "@/features/launch/repo";
import { can } from "@/features/tenancy/policy";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { workspacePayload } from "@/features/tenancy/workspace-server";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";

/**
 * GET /api/restaurants/[restaurantId]/launch — one café's onboarding state.
 *
 * The café is the path, so the checklist can no longer be asked for without
 * one. The checklist is the owner's onboarding (extract, review, publish,
 * print): a staff membership gets 403 rather than steps it must not take.
 * Non-members get 404, never 403, so café ids stay unprobeable.
 *
 * Spend rides on the account (`/api/account/usage`); the counts here are the
 * café's. Personalized data is never cached.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server data is not available yet — keep working locally.",
      503
    );
  }
  if (!userId) {
    return errorResponse("unauthorized", "Sign in to see your launch checklist.", 401);
  }

  const { restaurantId } = await params;
  try {
    const db = getDb();
    const workspace = await getRestaurantForUser(db, userId, restaurantId);
    if (!workspace) {
      return errorResponse("not_found", "That café does not exist.", 404);
    }
    if (!can(workspace.access, "settings.manage")) {
      return errorResponse(
        "forbidden",
        "The launch checklist belongs to the café you are acting in as its owner.",
        403
      );
    }
    const launch = await readLaunchStatus(db, userId, restaurantId);
    const response = NextResponse.json({
      workspace: workspacePayload(workspace),
      launch,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await reportError("launch.status_failed", error);
    return errorResponse("server_db_unavailable", "Could not load your checklist.", 503);
  }
}

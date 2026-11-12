import { NextResponse } from "next/server";

import { listPublishedMenuLinksForRestaurant } from "@/features/tables/repo";
import { can } from "@/features/tenancy/policy";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { workspacePayload } from "@/features/tenancy/workspace-server";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * GET /api/restaurants/[restaurantId]/tables — everything a table card needs
 * for one café: its `/r/<slug>` address and the live menus that address can
 * serve. One read, one café, no menu list for the browser to search.
 *
 * Owners and staff both print cards (`tables.print`); only an owner may claim
 * a new address (`tables.link`), which is a separate write. Non-members get
 * 404, a member without either capability gets 403.
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
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
  if (!userId) return errorResponse("unauthorized", "Sign in to continue.", 401);

  const { restaurantId } = await params;
  try {
    const db = getDb();
    const workspace = await getRestaurantForUser(db, userId, restaurantId);
    if (!workspace) {
      return errorResponse("not_found", "That café does not exist.", 404);
    }
    if (!can(workspace.access, "tables.print") && !can(workspace.access, "tables.link")) {
      return errorResponse("forbidden", "You do not print this café's cards.", 403);
    }
    const menus = await listPublishedMenuLinksForRestaurant(db, restaurantId);
    const response = NextResponse.json({
      workspace: workspacePayload(workspace),
      slug: workspace.slug,
      menus,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorResponse("server_db_unavailable", "Could not load table cards. Try again.", 503);
  }
}

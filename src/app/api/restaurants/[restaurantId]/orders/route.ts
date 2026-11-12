import { NextResponse } from "next/server";

import { listOrdersForStaff, OrderRepoError } from "@/features/orders/repo";
import { can } from "@/features/tenancy/policy";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { workspacePayload } from "@/features/tenancy/workspace-server";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";

/**
 * GET /api/restaurants/[restaurantId]/orders — the order board for one café.
 *
 * The café is required (in the path), so the board can no longer fall back to
 * every café the account belongs to: an absent or different café is a
 * different request, not a wider answer.
 *
 * - Non-members get 404; a member without `orders.read` gets 403.
 * - `since` returns everything changed after that server timestamp (status
 *   edits included), so the poller keeps working unchanged.
 * - Personalized data is never cached.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapRepoError(error: OrderRepoError): NextResponse {
  switch (error.code) {
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "not_found":
      return errorResponse("not_found", error.message, 404);
    case "invalid":
    default:
      return errorResponse("invalid_body", error.message, 400);
  }
}

export async function GET(
  request: Request,
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
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const limitParam = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  try {
    const db = getDb();
    const workspace = await getRestaurantForUser(db, userId, restaurantId);
    if (!workspace) {
      return errorResponse("not_found", "That café does not exist.", 404);
    }
    if (!can(workspace.access, "orders.read")) {
      return errorResponse("forbidden", "You do not take orders for this café.", 403);
    }
    const result = await listOrdersForStaff(db, userId, { since, restaurantId, limit });
    const response = NextResponse.json({
      workspace: workspacePayload(workspace),
      ...result,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) return mapRepoError(error);
    await reportError("orders.board_failed", error);
    return errorResponse("server_db_unavailable", "Could not load orders. Try again.", 503);
  }
}

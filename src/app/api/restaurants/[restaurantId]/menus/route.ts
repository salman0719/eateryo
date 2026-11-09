import { NextResponse } from "next/server";
import { z } from "zod";

import { menuDocumentSchema } from "@/features/menu/schema";
import { createMenuForUser, listMenusForRestaurant, MenuRepoError } from "@/features/menus/repo";
import { can } from "@/features/tenancy/policy";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { workspacePayload } from "@/features/tenancy/workspace-server";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET  /api/restaurants/[restaurantId]/menus — one café's menus.
 * POST /api/restaurants/[restaurantId]/menus — create a menu in that café.
 *
 * The café is the path, never the body: a caller cannot read one café's list
 * and write into another, and the response can never contain another
 * membership's rows for the browser to filter out later.
 *
 * - Non-members get 404, never 403, so café ids stay unprobeable.
 * - A member without menu access gets an empty list: that is an answer, not
 *   an error, and it does not hint that unpublished menus exist.
 * - A member without `menus.write` gets 403 on create.
 * - The body is strict: `{ doc }` only, so a stale client sending the old
 *   `{ restaurantId, doc }` shape is refused instead of silently ignored.
 *
 * Responses are personalized, so never cached.
 */

const createBody = z.object({ doc: menuDocumentSchema }).strict();

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
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

function mapRepoError(error: MenuRepoError): NextResponse {
  switch (error.code) {
    case "stale":
      return errorResponse("stale_menu", error.message, 409, {
        currentUpdatedAt: error.currentUpdatedAt,
      });
    case "exists":
      return errorResponse("menu_exists", error.message, 409);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "invalid_doc":
      return errorResponse("invalid_body", error.message, 400);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  try {
    const db = getDb();
    const workspace = await getRestaurantForUser(db, userId, restaurantId);
    if (!workspace) {
      return errorResponse("not_found", "That café does not exist.", 404);
    }
    const menus = await listMenusForRestaurant(db, userId, restaurantId);
    return noStore(NextResponse.json({ workspace: workspacePayload(workspace), menus }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not load menus. Try again.", 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
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
  const parsed = createBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const db = getDb();
    const workspace = await getRestaurantForUser(db, userId, restaurantId);
    if (!workspace) {
      return errorResponse("not_found", "That café does not exist.", 404);
    }
    if (!can(workspace.access, "menus.write")) {
      return errorResponse("forbidden", "Only an owner can add menus to this café.", 403);
    }
    const menu = await createMenuForUser(db, userId, restaurantId, parsed.data.doc);
    return noStore(NextResponse.json({ menu }, { status: 201 }));
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not save the menu. Try again.", 503);
  }
}

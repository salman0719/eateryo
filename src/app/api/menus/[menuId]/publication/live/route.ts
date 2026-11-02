import { NextResponse } from "next/server";

import { getLiveMenuDoc, PublicationRepoError } from "@/features/publishing/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * GET /api/menus/[menuId]/publication/live — the document table ordering is
 * serving for this menu right now (`{ doc: null }` when nothing is).
 *
 * The editor uses it for one thing: showing the owner what will change when
 * they press "Publish changes", by comparing this snapshot with the draft. It
 * is a member read, like the publication status; menus of other tenants are
 * 404, never 403. The snapshot is user data, so it is `no-store` like the rest
 * of the publication API.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ menuId: string }> }) {
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

  const { menuId } = await params;
  try {
    const doc = await getLiveMenuDoc(getDb(), userId, menuId);
    const response = NextResponse.json({ doc });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PublicationRepoError) {
      return errorResponse(error.code, error.message, error.code === "not_found" ? 404 : 403);
    }
    return errorResponse(
      "server_db_unavailable",
      "Could not load the published version. Try again.",
      503
    );
  }
}

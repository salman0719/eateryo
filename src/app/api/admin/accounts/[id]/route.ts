import { NextResponse } from "next/server";

import { getAccountDetail, PlatformRepoError } from "@/features/platform/repo";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { getDb } from "@/lib/db";

/**
 * GET /api/admin/accounts/[id] — one account with its cafés, menus,
 * usage, orders, sessions, events and timeline. Guard first, then the
 * id-scoped reads. The id comes from the path, never from a body —
 * there is no body on this route. Unknown ids are the plain 404, with
 * no internals, and every response is `no-store`.
 */

function errorResponse(code: string, message: string, status: number): NextResponse {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function noStore<T>(payload: T, status = 200): NextResponse {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const operatorId = await requirePlatformAdminApi();
  if (operatorId instanceof NextResponse) return operatorId;
  const { id } = await params;

  try {
    const detail = await getAccountDetail(getDb(), id);
    return noStore(detail);
  } catch (error) {
    if (error instanceof PlatformRepoError && error.code === "not_found") {
      return errorResponse("not_found", "Not found.", 404);
    }
    return errorResponse("server_db_unavailable", "Could not load that account. Try again.", 503);
  }
}

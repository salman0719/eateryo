import { NextResponse } from "next/server";

import { listPlatformEvents, PlatformRepoError } from "@/features/platform/repo";
import { adminEventsQuerySchema, decodeAdminCursor } from "@/features/platform/schema";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { getDb } from "@/lib/db";

/**
 * GET /api/admin/events — the operator log, newest first. Query:
 * `action? cursor?`. Same shape as the accounts list: guard, Zod
 * query parse, keyset page, `no-store` on every response.
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

export async function GET(request: Request): Promise<NextResponse> {
  const operatorId = await requirePlatformAdminApi();
  if (operatorId instanceof NextResponse) return operatorId;

  const parsed = adminEventsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return errorResponse(
      "invalid_query",
      parsed.error.issues[0]?.message ?? "That events query is not valid.",
      400
    );
  }

  const rawCursor = parsed.data.cursor;
  const cursor = decodeAdminCursor(rawCursor);
  if (rawCursor && !cursor) {
    return errorResponse("invalid_cursor", "That page cursor is not valid.", 400);
  }

  try {
    const page = await listPlatformEvents(getDb(), { action: parsed.data.action, cursor });
    return noStore(page);
  } catch (error) {
    if (error instanceof PlatformRepoError && error.code === "invalid_cursor") {
      return errorResponse("invalid_cursor", error.message, 400);
    }
    return errorResponse(
      "server_db_unavailable",
      "Could not load the operator log. Try again.",
      503
    );
  }
}

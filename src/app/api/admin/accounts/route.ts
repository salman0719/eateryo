import { NextResponse } from "next/server";

import { listAccounts, PlatformRepoError } from "@/features/platform/repo";
import { adminAccountsQuerySchema, decodeAdminCursor } from "@/features/platform/schema";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { getDb } from "@/lib/db";

/**
 * GET /api/admin/accounts — one page of accounts with aggregates.
 * Query: `q? filter? sort? cursor?`. Guard first (signed-out → 401,
 * non-operator → plain 404), then a Zod query parse, then the page
 * query. The cursor is opaque base64url; a forged one is a 400.
 * Every response is `no-store`: account data is never cached.
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

  const parsed = adminAccountsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return errorResponse(
      "invalid_query",
      parsed.error.issues[0]?.message ?? "That accounts query is not valid.",
      400
    );
  }

  const rawCursor = parsed.data.cursor;
  const cursor = decodeAdminCursor(rawCursor);
  if (rawCursor && !cursor) {
    return errorResponse("invalid_cursor", "That page cursor is not valid.", 400);
  }

  try {
    const page = await listAccounts(getDb(), {
      q: parsed.data.q,
      filter: parsed.data.filter,
      sort: parsed.data.sort,
      cursor,
    });
    return noStore(page);
  } catch (error) {
    if (error instanceof PlatformRepoError && error.code === "invalid_cursor") {
      return errorResponse("invalid_cursor", error.message, 400);
    }
    return errorResponse("server_db_unavailable", "Could not load the accounts. Try again.", 503);
  }
}

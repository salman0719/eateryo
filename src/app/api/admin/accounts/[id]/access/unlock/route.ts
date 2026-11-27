import { NextResponse } from "next/server";
import { z } from "zod";

import { PlatformRepoError, unlockAccount } from "@/features/platform/repo";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST /api/admin/accounts/[id]/access/unlock — clear the sign-in lockout.
 *
 * The 5-attempt/15-minute counter and the `lockedUntil` instant reset
 * together, recorded as `account.unlocked`, atomically. With nothing
 * to clear it reports `not_locked` (404) instead of logging a no-op,
 * so the operator log stays a record of real actions. There is no
 * request body: the action carries no parameters.
 *
 * Guard first (signed-out → 401, non-operator → plain 404), then
 * `rejectCrossOrigin`, then the atomic repo call. Every response is
 * `no-store`.
 */

const emptyBody = z.object({});

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

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const operatorId = await requirePlatformAdminApi();
  if (operatorId instanceof NextResponse) return operatorId;
  const { id } = await params;

  const parsed = emptyBody.safeParse(await readBody(request));
  if (!parsed.success) {
    return errorResponse("invalid_body", "This action takes no body.", 400);
  }

  try {
    const result = await unlockAccount(getDb(), {
      targetUserId: id,
      actorUserId: operatorId,
    });
    return noStore({ unlocked: true, clearedAttempts: result.clearedAttempts });
  } catch (error) {
    if (error instanceof PlatformRepoError) {
      if (error.code === "not_locked") {
        return errorResponse("not_locked", error.message, 404);
      }
      if (error.code === "not_found") {
        return errorResponse("not_found", error.message, 404);
      }
    }
    return errorResponse("server_db_unavailable", "Could not unlock sign-in. Try again.", 503);
  }
}

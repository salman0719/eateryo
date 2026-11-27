import { NextResponse } from "next/server";
import { z } from "zod";

import { PlatformRepoError, resetTwoFactor } from "@/features/platform/repo";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST /api/admin/accounts/[id]/access/two-factor/reset — reset the second factor.
 *
 * The TOTP secret and its backup codes die, `twoFactorEnabled` clears so
 * the next sign-in re-enrols, and live sessions die with the reset —
 * recorded as `two_factor.reset`, once, atomically. With no factor
 * enrolled it reports `not_enrolled` (404) instead of logging a no-op,
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
    const result = await resetTwoFactor(getDb(), {
      targetUserId: id,
      actorUserId: operatorId,
    });
    return noStore({ twoFactorReset: true, sessionsRevoked: result.sessionsRevoked });
  } catch (error) {
    if (error instanceof PlatformRepoError) {
      if (error.code === "not_enrolled") {
        return errorResponse("not_enrolled", error.message, 404);
      }
      if (error.code === "not_found") {
        return errorResponse("not_found", error.message, 404);
      }
    }
    return errorResponse(
      "server_db_unavailable",
      "Could not reset the second factor. Try again.",
      503
    );
  }
}

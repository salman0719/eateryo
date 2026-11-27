import { NextResponse } from "next/server";
import { z } from "zod";

import { forcePasswordReset, PlatformRepoError } from "@/features/platform/repo";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { sendPasswordResetEmail } from "@/lib/auth/email";
import { mintPasswordResetToken } from "@/lib/auth/reset-tokens";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logEvent } from "@/lib/observability/log";

/**
 * POST /api/admin/accounts/[id]/access/reset — force a password reset.
 *
 * The account must set a new password at next sign-in; its live
 * sessions die with the requirement, the same revocation suspension
 * performs. Recorded as `password.reset`, atomically, and the 30-minute
 * reset link is emailed to the account (P5) — recovery that needs no
 * operator after this click. There is no request body: the action
 * carries no parameters.
 *
 * Delivery is best-effort after the state change: a send failure is
 * logged, never a 500, so a mail outage cannot strand the requirement
 * without its link (the account can still ask for one self-serve).
 *
 * Guard first (signed-out → 401, non-operator → plain 404), then
 * `rejectCrossOrigin`, then the atomic repo call. Unknown ids are
 * the plain 404; every response is `no-store`.
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
    const result = await forcePasswordReset(getDb(), {
      targetUserId: id,
      actorUserId: operatorId,
    });
    try {
      const { token } = await mintPasswordResetToken(getDb(), id);
      const url = new URL("/sign-in/reset", request.url);
      url.searchParams.set("token", token);
      await sendPasswordResetEmail({ email: result.targetEmail, url: url.toString() });
    } catch (error) {
      logEvent("error", "auth.password_reset_send_failed", { error });
    }
    return noStore({
      reset: { resetSentAt: result.resetSentAt },
      sessionsRevoked: result.sessionsRevoked,
    });
  } catch (error) {
    if (error instanceof PlatformRepoError && error.code === "not_found") {
      return errorResponse("not_found", error.message, 404);
    }
    return errorResponse(
      "server_db_unavailable",
      "Could not force a password reset. Try again.",
      503
    );
  }
}

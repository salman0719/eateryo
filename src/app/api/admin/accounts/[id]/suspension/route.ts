import { NextResponse } from "next/server";
import { z } from "zod";

import { PlatformRepoError, restoreAccount, suspendAccount } from "@/features/platform/repo";
import { requirePlatformAdminApi } from "@/lib/auth/platform-admin";
import { getDb } from "@/lib/db";
import { SUSPENSION_REASONS } from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST   /api/admin/accounts/[id]/suspension — suspend an account. Body
 *   `{ reason: enum, note?: string ≤ 500 }`; the reason is required because
 *   an unexplained suspension is unanswerable a month later.
 * DELETE /api/admin/accounts/[id]/suspension — restore an account. Body
 *   `{ note?: string ≤ 500 }` is optional; empty bodies are accepted.
 *
 * Both run the operator guard first (signed-out → 401, non-operator →
 * plain 404), then a Zod body parse, then `rejectCrossOrigin`, then the
 * atomic repo call. Errors use the app's { error: { code, message } }
 * shape with no internals; the reason never leaves the server. The id
 * comes from the path, never from the body.
 */

const suspendBody = z.object({
  reason: z.enum(SUSPENSION_REASONS),
  note: z.string().max(500).optional(),
});

const restoreBody = z.object({
  note: z.string().max(500).optional(),
});

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

function mapRepoError(error: PlatformRepoError): NextResponse {
  switch (error.code) {
    case "suspension_active":
      return errorResponse("suspension_active", error.message, 409);
    case "no_open_suspension":
      return errorResponse("no_open_suspension", error.message, 404);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // DELETE restores carry no body; POST falls through to the 400 below.
    return {};
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const operatorId = await requirePlatformAdminApi();
  if (operatorId instanceof NextResponse) return operatorId;
  const { id } = await params;

  const parsed = suspendBody.safeParse(await readBody(request));
  if (!parsed.success) {
    return errorResponse(
      "invalid_body",
      parsed.error.issues[0]?.message ?? "Expected { reason, note? }.",
      400
    );
  }

  try {
    const result = await suspendAccount(getDb(), {
      targetUserId: id,
      reason: parsed.data.reason,
      note: parsed.data.note,
      actorUserId: operatorId,
    });
    return noStore({
      suspension: {
        ...result.suspension,
        createdAt: result.suspension.createdAt.toISOString(),
      },
      sessionsRevoked: result.sessionsRevoked,
    });
  } catch (error) {
    if (error instanceof PlatformRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not suspend the account. Try again.", 503);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const operatorId = await requirePlatformAdminApi();
  if (operatorId instanceof NextResponse) return operatorId;
  const { id } = await params;

  const parsed = restoreBody.safeParse(await readBody(request));
  if (!parsed.success) {
    return errorResponse(
      "invalid_body",
      parsed.error.issues[0]?.message ?? "Expected { note? }.",
      400
    );
  }

  try {
    const result = await restoreAccount(getDb(), {
      targetUserId: id,
      note: parsed.data.note,
      actorUserId: operatorId,
    });
    return noStore({ restored: true, suspensionId: result.suspensionId });
  } catch (error) {
    if (error instanceof PlatformRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not restore the account. Try again.", 503);
  }
}

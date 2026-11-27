import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { APIError } from "better-auth/api";

import { getAuth } from "@/lib/auth";
import { AccountStateError, assertAccountActive, markPasswordSet } from "@/lib/auth/account-state";
import { validateNewPassword } from "@/lib/auth/passwords";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST /api/account/password — set the signed-in account's password (P2).
 *
 * The first set needs only the session the verified link minted; changing
 * an existing password additionally needs the current one. Rules run here
 * with the settled copy, hashing stays the library's default, and success
 * stamps `passwordSetAt` so the Access card flips from "no password yet".
 * Anonymous callers get 401 — without a verified link's session there is
 * nothing to set on. Error shape: { error: { code, message } }, no-store.
 */

const bodySchema = z.object({
  password: z.string().min(1).max(512),
  confirm: z.string().min(1).max(512),
  currentPassword: z.string().min(1).max(512).optional(),
});

function errorResponse(code: string, message: string, status: number): NextResponse {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function libraryCode(error: unknown): string | null {
  if (error instanceof APIError) {
    const body = error.body as { code?: unknown } | undefined;
    if (body && typeof body.code === "string") return body.code;
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  let session: { id: string; email: string } | null;
  try {
    session = await getSessionUser();
  } catch {
    return errorResponse("server_db_unavailable", "Setting a password is not available yet.", 503);
  }
  if (!session) {
    return errorResponse("unauthorized", "Sign in to set a password.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_body",
      'Send { "password", "confirm" } and, when changing, "currentPassword".',
      400
    );
  }
  const { password, confirm, currentPassword } = parsed.data;

  const ruleMessage = validateNewPassword(password, confirm, session.email);
  if (ruleMessage) {
    return errorResponse("invalid_password", ruleMessage, 400);
  }

  const db = getDb();
  try {
    await assertAccountActive(db, session.id);
  } catch (error) {
    if (error instanceof AccountStateError) {
      return errorResponse("account_suspended", error.message, 403);
    }
    return errorResponse("server_db_unavailable", "Setting a password is not available yet.", 503);
  }

  const auth = getAuth();
  try {
    const credential = await db
      .select({ id: account.id, password: account.password })
      .from(account)
      .where(and(eq(account.userId, session.id), eq(account.providerId, "credential")))
      .limit(1);

    if (!credential[0]?.password) {
      // First set (or a credential row without a hash): the session the
      // verified link minted is the only proof needed.
      await auth.api.setPassword({
        body: { newPassword: password },
        headers: request.headers,
      });
    } else {
      if (!currentPassword) {
        return errorResponse(
          "current_password_required",
          "Enter your current password to change it.",
          400
        );
      }
      await auth.api.changePassword({
        body: { newPassword: password, currentPassword },
        headers: request.headers,
      });
    }
  } catch (error) {
    switch (libraryCode(error)) {
      case "INVALID_PASSWORD":
        return errorResponse("invalid_current_password", "Current password is incorrect.", 401);
      case "PASSWORD_ALREADY_SET":
        return errorResponse(
          "password_already_set",
          "A password is already set — change it with your current password.",
          409
        );
      default:
        return errorResponse("server_error", "Could not set the password. Try again.", 500);
    }
  }

  try {
    await markPasswordSet(db, session.id);
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Password saved, but its state did not stamp. Sign in again.",
      503
    );
  }

  const response = NextResponse.json({ passwordSet: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

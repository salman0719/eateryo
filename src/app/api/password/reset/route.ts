import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

import { AccountStateError, assertAccountActive, markPasswordSet } from "@/lib/auth/account-state";
import { validateNewPassword } from "@/lib/auth/passwords";
import { consumePasswordResetToken, findValidResetToken } from "@/lib/auth/reset-tokens";
import { getDb } from "@/lib/db";
import { account, session, user } from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logEvent } from "@/lib/observability/log";

/**
 * POST /api/password/reset — spend a reset link to set a new password (P5).
 *
 * Unknown, expired, and spent tokens share one failure copy, so the
 * endpoint never says which case it was. The new password is validated
 * *before* the single use is burned — a typo must not eat the link — and
 * setting it revokes every live session and satisfies a forced reset,
 * through the same `markPasswordSet` the verified set-password flow uses.
 * Emailing the link stays proof enough to clear a lockout too, the way a
 * recovery code clears one: control of the inbox ends the guessing.
 * Error shape: { error: { code, message } }, no-store.
 */

const bodySchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
  confirm: z.string().min(1).max(512),
});

/** The one failure copy for a dead link, whatever killed it. */
export const INVALID_RESET_TOKEN_COPY =
  "This reset link is invalid or expired. Request a new one and try again.";

function errorResponse(code: string, message: string, status: number): NextResponse {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

const dbUnavailable = () =>
  errorResponse("server_db_unavailable", "Password reset is not available yet — try again.", 503);

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", 'Send { "token", "password", "confirm" }.', 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", 'Send { "token", "password", "confirm" }.', 400);
  }
  const { token, password, confirm } = parsed.data;

  const db = getDb();
  let peek: { userId: string } | null;
  try {
    peek = await findValidResetToken(db, token);
  } catch (error) {
    logEvent("error", "auth.password_reset_read_failed", { error });
    return dbUnavailable();
  }
  if (!peek) return errorResponse("invalid_token", INVALID_RESET_TOKEN_COPY, 400);

  let address: string | null = null;
  try {
    const rows = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, peek.userId))
      .limit(1);
    address = rows[0]?.email ?? null;
  } catch (error) {
    logEvent("error", "auth.password_reset_read_failed", { error });
    return dbUnavailable();
  }
  if (!address) return errorResponse("invalid_token", INVALID_RESET_TOKEN_COPY, 400);

  const ruleMessage = validateNewPassword(password, confirm, address);
  if (ruleMessage) return errorResponse("invalid_password", ruleMessage, 400);

  try {
    await assertAccountActive(db, peek.userId);
  } catch (error) {
    if (error instanceof AccountStateError) {
      return errorResponse("account_suspended", error.message, 403);
    }
    logEvent("error", "auth.password_reset_read_failed", { error });
    return dbUnavailable();
  }

  let spent: { userId: string } | null;
  try {
    spent = await consumePasswordResetToken(db, token);
  } catch (error) {
    logEvent("error", "auth.password_reset_write_failed", { error });
    return dbUnavailable();
  }
  if (!spent) return errorResponse("invalid_token", INVALID_RESET_TOKEN_COPY, 400);

  try {
    const hashed = await hashPassword(password);
    const existing = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, spent.userId), eq(account.providerId, "credential")))
      .limit(1);
    if (existing[0]) {
      await db.update(account).set({ password: hashed }).where(eq(account.id, existing[0].id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        userId: spent.userId,
        providerId: "credential",
        accountId: spent.userId,
        password: hashed,
      });
    }
    await db.delete(session).where(eq(session.userId, spent.userId));
    await markPasswordSet(db, spent.userId);
  } catch (error) {
    logEvent("error", "auth.password_reset_write_failed", { error });
    return dbUnavailable();
  }

  const response = NextResponse.json({ passwordReset: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

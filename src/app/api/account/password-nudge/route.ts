import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { account, user } from "@/lib/db/schema";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET /api/account/password-nudge — whether the post-sign-in password
 * nudge may show: `{ eligible }`. Eligible means all three: the account
 * is older than 24 hours, it has no password, and it never dismissed the
 * nudge. The age floor keeps fresh accounts out of the funnel; the
 * dismissal is per account, so the nudge shows at most once ever.
 * Anonymous callers get 401 — eligibility belongs to the session that
 * proved it, never to a stranger (the sign-in oracle rule).
 *
 * POST /api/account/password-nudge — `{ dismissed: true }` stamps the
 * dismissal. Idempotent: dismissing twice still answers `{ dismissed:
 * true }`. Error shape for both: { error: { code, message } }, no-store.
 */

const NUDGE_AGE_MS = 24 * 60 * 60 * 1000;

const dismissSchema = z.object({ dismissed: z.literal(true) });

function errorResponse(code: string, message: string, status: number): NextResponse {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function readEligibility(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<{ hasPassword: boolean; eligible: boolean }> {
  const users = await db
    .select({ createdAt: user.createdAt, dismissedAt: user.passwordNudgeDismissedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (users.length === 0) return { hasPassword: false, eligible: false };

  const credentials = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, "credential"),
        isNotNull(account.password)
      )
    )
    .limit(1);
  const hasPassword = credentials.length > 0;
  // Absolute instants, so no wall-clock zone is involved: the 24-hour
  // floor is the same on every machine the server runs on.
  const ageMs = Date.now() - users[0].createdAt.getTime();
  const eligible = !hasPassword && users[0].dismissedAt === null && ageMs >= NUDGE_AGE_MS;
  return { hasPassword, eligible };
}

export async function GET(): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return errorResponse("server_db_unavailable", "The nudge state is not available yet.", 503);
  }
  if (!userId) {
    return errorResponse("unauthorized", "Sign in to see the nudge state.", 401);
  }

  try {
    const { eligible } = await readEligibility(getDb(), userId);
    const response = NextResponse.json({ eligible });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorResponse("server_db_unavailable", "The nudge state is not available yet.", 503);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return errorResponse("server_db_unavailable", "The nudge state is not available yet.", 503);
  }
  if (!userId) {
    return errorResponse("unauthorized", "Sign in to dismiss the nudge.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", 'Send { "dismissed": true }.', 400);
  }
  if (!dismissSchema.safeParse(body).success) {
    return errorResponse("invalid_body", 'Send { "dismissed": true }.', 400);
  }

  try {
    const db = getDb();
    await db.update(user).set({ passwordNudgeDismissedAt: new Date() }).where(eq(user.id, userId));
  } catch {
    return errorResponse("server_db_unavailable", "The nudge state is not available yet.", 503);
  }

  const response = NextResponse.json({ dismissed: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

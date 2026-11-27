import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { account } from "@/lib/db/schema";

/**
 * GET /api/account/password-status — whether the signed-in account has a
 * password: `{ hasPassword }`. The Settings password card and the
 * post-sign-in nudge both read it; the card links to `/set-password`,
 * which owns the set/change flow. Anonymous callers get 401 — a password
 * state belongs to the session that proved it, never to a stranger
 * (the sign-in oracle rule). Error shape: { error: { code, message } },
 * no-store.
 */
export async function GET(): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "server_db_unavailable",
          message: "The password state is not available yet.",
        },
      },
      { status: 503 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to see the password state." } },
      { status: 401 }
    );
  }

  try {
    const rows = await getDb()
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
    const response = NextResponse.json({ hasPassword: rows.length > 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "server_db_unavailable",
          message: "The password state is not available yet.",
        },
      },
      { status: 503 }
    );
  }
}

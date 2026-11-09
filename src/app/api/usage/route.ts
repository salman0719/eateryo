import { NextResponse } from "next/server";

import { getAssistantSpendSummary } from "@/features/assistant/repo";
import { getMonthlyUsageSummary } from "@/features/usage/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";

/**
 * GET /api/usage — this account's extraction usage for the current UTC month,
 * plus the cap that applies and how much remains (the free-launch cost brake),
 * and the assistant's own spend for the same window.
 *
 * No café is named because neither half belongs to one: the allowance is the
 * account's, so a staff member reads their own numbers here. The launch
 * checklist is the owner's and 403s for a shift; spend must not inherit that
 * refusal.
 *
 * Session-scoped: the user id comes from the verified session, so one account
 * can never read another's spend. Personalized data is never cached.
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
          message: "Usage is not available yet — keep working locally.",
        },
      },
      { status: 503 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to see your usage." } },
      { status: 401 }
    );
  }

  try {
    const db = getDb();
    const [usage, assistant] = await Promise.all([
      getMonthlyUsageSummary(db, userId),
      getAssistantSpendSummary(db, userId),
    ]);
    const response = NextResponse.json({ usage, assistant });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await reportError("usage.summary_failed", error);
    return NextResponse.json(
      { error: { code: "server_db_unavailable", message: "Could not load usage. Try again." } },
      { status: 503 }
    );
  }
}

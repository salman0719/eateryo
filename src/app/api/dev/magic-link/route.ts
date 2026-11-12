import { NextResponse } from "next/server";

import { isDevSignInEnabled, takeDevSignInLink } from "@/lib/auth/dev-sign-in";

/**
 * Development-only: hand back the magic link that was just generated for this
 * address instead of emailing it (see `src/lib/auth/dev-sign-in.ts`). Answers
 * 404 whenever the shortcut is off, so a deployed build has no address that
 * returns a credential; the link itself is single-use and expires in five
 * minutes.
 */
export async function GET(request: Request) {
  if (!isDevSignInEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const email = new URL(request.url).searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }

  const url = takeDevSignInLink(email);
  if (!url) {
    return NextResponse.json({ error: "no_pending_link" }, { status: 404 });
  }

  return NextResponse.json({ url }, { headers: { "cache-control": "no-store" } });
}

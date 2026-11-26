import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * Platform admin shell (B0) — the operator-only gate.
 *
 * Signed-out visits redirect to sign-in with `next=/admin`; signed-in
 * non-operators (and revoked operators, and a DB we cannot reach) get the
 * plain 404, never a reason. The gate BLOCKS: it reads the session cookie
 * before anything renders. Streaming it behind `<Suspense>` was tried and
 * reverted — the sessionless prerender's redirect/not-found mixed with the
 * per-request answer in the flight payload and operators hung on the
 * fallback in dev, so a guard streams nothing. The chrome is deliberately
 * its own: no café shell imports, so no workspace state leaks into the
 * panel. Real pages (overview, accounts, cafés, activity) arrive in B3;
 * until then the stub page below is all there is.
 */

// A guard cannot stream: this subtree renders on demand, per request,
// instead of prerendering an instant shell (Next 16 cacheComponents).
export const instant = false;

export const metadata: Metadata = {
  title: "Platform admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // No session (or no reachable session store) reads as anonymous here;
  // redirect() is outside the try below so it is never swallowed.
  const account = await getSessionUser().catch(() => null);
  if (!account) redirect("/sign-in?next=/admin");

  // Non-operators, revoked operators and an unreachable DB all read as the
  // same plain 404 — never a reason.
  let allowed = false;
  try {
    allowed = await isPlatformAdmin(getDb(), account.id);
  } catch {
    allowed = false;
  }
  if (!allowed) notFound();

  return (
    <div className="min-h-dvh bg-surface-50 text-ink-900">
      <header className="border-b border-line-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold tracking-tight">Eateryo platform</p>
          <p className="text-xs text-ink-500">Operators only</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

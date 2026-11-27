import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { isTwoFactorEnrolled } from "@/lib/auth/account-state";
import { getSessionUser } from "@/lib/auth/session";
import { AdminNav } from "@/components/platform/admin-nav";
import { getDb } from "@/lib/db";

/**
 * Platform admin shell (B0 gate, B3 chrome) — the operator-only gate.
 *
 * Signed-out visits redirect to sign-in with `next=/admin`; signed-in
 * non-operators (and revoked operators, and a DB we cannot reach) get the
 * plain 404, never a reason. The gate BLOCKS: it reads the session cookie
 * before anything renders. Streaming it behind `<Suspense>` was tried and
 * reverted — the sessionless prerender's redirect/not-found mixed with the
 * per-request answer in the flight payload and operators hung on the
 * fallback in dev, so a guard streams nothing. The chrome is deliberately
 * its own: no café shell imports, so no workspace state leaks into the
 * panel. The §4 left column (overview, accounts, cafés, activity) is the
 * nav; the pages themselves arrive one commit at a time in B3.
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

  // Operators without a second factor set one up first (P6): the panel
  // holds every café's data, so a password alone is not enough to open
  // it. The setup screen lives outside `/admin`, so this cannot loop.
  let enrolled = false;
  try {
    enrolled = await isTwoFactorEnrolled(getDb(), account.id);
  } catch {
    enrolled = false;
  }
  if (!enrolled) redirect("/sign-in/factor/setup?next=/admin");

  return (
    <div className="min-h-dvh bg-surface-50 text-ink-900">
      <header className="border-b border-line-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold tracking-tight">Eateryo platform</p>
          <p className="text-xs text-ink-500">Operators only</p>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 lg:flex-row">
        <div className="lg:w-60 lg:shrink-0">
          <AdminNav />
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

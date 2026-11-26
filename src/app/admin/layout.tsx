import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * Platform admin shell (B0) — the operator-only gate.
 *
 * Signed-out visits redirect to sign-in with `next=/admin`; signed-in
 * non-operators (and revoked operators, and a DB we cannot reach) get the
 * plain 404, never a reason. The gate reads the session cookie, which is
 * request-time data, so it streams behind a placeholder like the invitation
 * page does — the chrome paints before the gate resolves. The chrome is
 * deliberately its own: no café shell imports, so no workspace state leaks
 * into the panel. Real pages (overview, accounts, cafés, activity) arrive
 * in B3; until then the stub page below is all there is.
 */

export const metadata: Metadata = {
  title: "Platform admin",
  robots: { index: false, follow: false },
};

/** The operator-only gate: cookie read, redirect-or-404, then the page. */
async function AdminGate({ children }: { children: ReactNode }) {
  // Per-request like the diner table page: the gate reads the session cookie.
  await connection();
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
  return children;
}

function AdminGateLoading() {
  return (
    <section aria-busy="true">
      <span className="sr-only">Checking operator access…</span>
      <div className="h-8 w-56 animate-pulse rounded bg-surface-200" />
      <div className="mt-3 h-4 w-80 animate-pulse rounded bg-surface-200" />
    </section>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-50 text-ink-900">
      <header className="border-b border-line-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold tracking-tight">Eateryo platform</p>
          <p className="text-xs text-ink-500">Operators only</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Suspense fallback={<AdminGateLoading />}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
    </div>
  );
}

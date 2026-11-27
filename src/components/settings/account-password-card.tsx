"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * The account-scope password card (Settings, beside export) — the only
 * in-app door to `/set-password`, which nothing linked to before. A
 * link-only account gets "Set a password" (skip the email wait next
 * time); an account with one gets "Change password". Renders nothing
 * until the status answers, so it never flashes the wrong call to
 * action, and nothing while signed out, like the export card.
 */
export function AccountPasswordCard() {
  const { data: session, isPending } = authClient.useSession();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    if (isPending || !session?.user) return;
    let cancelled = false;
    fetch("/api/account/password-status", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { hasPassword?: unknown } | null) => {
        if (!cancelled && typeof body?.hasPassword === "boolean") setHasPassword(body.hasPassword);
      })
      .catch(() => {
        // A status the server cannot answer leaves the card hidden rather
        // than pointing at a flow that cannot work either.
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, session?.user]);

  // Same gate as the export card; hooks stay above the early return. The
  // status read is second: an unanswered status renders nothing, never a
  // provisional call to action.
  if (!isPending && !session?.user) return null;
  if (hasPassword === null) return null;

  return (
    <section className="rounded-2xl border border-line-200 bg-surface-base p-5">
      <h3 className="text-sm font-bold tracking-tight text-ink-900">Password</h3>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        {hasPassword
          ? "A password is set on this account — it signs in in one step, no email wait."
          : "No password yet — you sign in with emailed links. Set one to sign in in one step."}
      </p>
      <div className="mt-3">
        <Link
          href="/set-password"
          className="inline-block rounded-lg border border-line-300 bg-surface-base px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          {hasPassword ? "Change password" : "Set a password"}
        </Link>
      </div>
    </section>
  );
}

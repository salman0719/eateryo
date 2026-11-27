"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The post-sign-in password nudge — mounted by the app shell for signed-in
 * accounts, invisible until the eligibility read answers. Eligible means
 * the account is older than 24 hours, has no password, and never dismissed
 * the nudge, so most sessions render nothing and no session ever sees it
 * twice. "Not now" stamps the per-account dismissal; "Set a password"
 * leaves for `/set-password`, which ends the nudge by itself. A dismissal
 * the server cannot record keeps the banner rather than lying about it.
 */
export function PasswordNudgeBanner() {
  const [eligible, setEligible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/password-nudge", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { eligible?: unknown } | null) => {
        if (!cancelled && body?.eligible === true) setEligible(true);
      })
      .catch(() => {
        // An unreadable nudge state is not a visible one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!eligible) return null;

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    try {
      const response = await fetch("/api/account/password-nudge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      if (response.ok) setEligible(false);
    } catch {
      // Recorded nowhere: the banner stays, and the next mount re-asks.
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">Sign in faster next time</p>
          <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-600">
            Set a password and skip the emailed link — or keep using links, either way works.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/set-password"
            className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Set a password
          </Link>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={dismissing}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

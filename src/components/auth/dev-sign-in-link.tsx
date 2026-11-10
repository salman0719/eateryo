"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `DEV_SIGN_IN_BYPASS` read-back, shared by every surface that offers a magic
 * link (the sign-in page, the publish wizard, and the invitation page).
 *
 * With the bypass on, the auth server parks the one-time link instead of
 * emailing it (see `src/lib/auth/dev-sign-in.ts`). A surface that sends a link
 * without reading it back tells the person to check an inbox that will never
 * receive anything — which is exactly what the invitation page used to do.
 *
 * `requestKey` changes on every send, so a resend for the same address earns a
 * fresh read: the previous link was spent by the first read, and the link is
 * single-use.
 */
export function useDevSignInLink({
  enabled,
  email,
  requestKey,
}: {
  enabled: boolean;
  email: string | null;
  requestKey: number | null;
}): { url: string | null; settling: boolean } {
  const [result, setResult] = useState<{ id: string; url: string | null } | null>(null);
  const readRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !email || requestKey === null) return;
    const id = `${email}\u0000${requestKey}`;
    // One read per request: React's development double-mount would otherwise
    // spend the link on the first call and report an expiry that never happened.
    if (readRef.current === id) return;
    readRef.current = id;
    let cancelled = false;
    fetch(`/api/dev/magic-link?email=${encodeURIComponent(email)}`, { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { url?: string }) : null
      )
      .then((body) => {
        if (!cancelled) setResult({ id, url: body?.url ?? null });
      })
      .catch(() => {
        if (!cancelled) setResult({ id, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, email, requestKey]);

  const requestId = email !== null && requestKey !== null ? `${email}\u0000${requestKey}` : null;
  const settled = result !== null && result.id === requestId;
  return { url: settled ? result.url : null, settling: !settled };
}

/**
 * The dashed "no email was sent" panel: names the shortcut, offers the parked
 * link, and never pretends a message is on its way. `onReset` returns the
 * surface to its send state so a spent or expired link can be replaced.
 */
export function DevSignInPanel({
  email,
  url,
  settling,
  onReset,
  resetLabel = "Use a different email",
}: {
  email: string;
  url: string | null;
  settling: boolean;
  onReset: () => void;
  resetLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-400 bg-surface-50 p-4 text-sm text-ink-700">
      <p className="font-medium">Development sign-in — no email was sent</p>
      <p className="mt-1">
        <code className="rounded bg-surface-200 px-1 py-0.5 text-[12px]">DEV_SIGN_IN_BYPASS</code>{" "}
        is on, so the one-time link for <span className="font-medium">{email}</span> is shown here
        instead of being emailed. It expires in 5 minutes.
      </p>
      {settling ? (
        <p className="mt-3 text-ink-500">Preparing the link…</p>
      ) : url ? (
        <a
          href={url}
          className="mt-3 inline-block rounded-lg bg-surface-900 px-4 py-2 text-sm font-semibold text-on-accent hover:bg-surface-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-900"
        >
          Open the sign-in link
        </a>
      ) : (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-danger-800"
        >
          Couldn&apos;t read the link back — it may have expired. Send a fresh one.
        </p>
      )}
      <button
        type="button"
        className="mt-3 block text-xs text-ink-600 underline underline-offset-2 hover:text-ink-900"
        onClick={onReset}
      >
        {resetLabel}
      </button>
    </div>
  );
}

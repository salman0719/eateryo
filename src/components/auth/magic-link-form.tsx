"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { linkExpiryCopy, type WizardLinkSent } from "@/features/publishing/wizard-state";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string; sentAt: number }
  | { kind: "error"; message: string };

/** A link verification the server bounced back here with `?error=…`. */
function readLinkErrorParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("error") !== null;
  } catch {
    return false;
  }
}

/** Forget the failure param so a reload doesn't repeat the notice. */
function clearLinkErrorParam(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("error") && !params.has("error_description")) return;
    params.delete("error");
    params.delete("error_description");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  } catch {
    // The notice still shows; only the address bar stays noisy.
  }
}

/**
 * The one human sign-in form (magic link, PHASE-2.md §3.6), shared by the
 * standalone sign-in page and the publish wizard. The wizard passes its own
 * `callbackURL` so the emailed link returns to the draft instead of the home
 * screen — the draft itself is already safe in IndexedDB.
 *
 * The "check your email" panel survives remounts: the wizard restores it
 * from `initialSent`, a live countdown names the expiry, and a dead link
 * that bounces back with `?error=…` explains itself with a resend path
 * instead of failing silently.
 */
export function MagicLinkForm({
  callbackURL,
  initialSent,
  onSent,
  onSentCleared,
  devSignIn = false,
}: {
  /** Same-origin path the emailed link returns to. */
  callbackURL: string;
  /** A link the owner already requested (restored after reload or return). */
  initialSent?: WizardLinkSent | null;
  /** A fresh link was requested (persist it so the panel survives). */
  onSent?: (sent: WizardLinkSent) => void;
  /** The sent panel was dismissed (forget the stored request). */
  onSentCleared?: () => void;
  /**
   * Development shortcut: read the one-time link back from the server and
   * offer it here instead of waiting for an email. The server only answers
   * when `DEV_SIGN_IN_BYPASS` is on outside production; off by default.
   */
  devSignIn?: boolean;
}) {
  const [email, setEmail] = useState(initialSent?.email ?? "");
  const [status, setStatus] = useState<Status>(() =>
    initialSent
      ? { kind: "sent", email: initialSent.email, sentAt: initialSent.sentAt }
      : { kind: "idle" }
  );
  const [linkError, setLinkError] = useState<boolean>(readLinkErrorParam);
  // The captured dev link, tagged with the address it belongs to so a resent
  // link never shows the previous one while the new one is being fetched.
  const [devLink, setDevLink] = useState<{ email: string; url: string | null } | null>(null);
  const inputId = useId();

  // Ticks the expiry countdown while a link is pending. The clock starts
  // after mount (never during prerender) and the first frame corrects it
  // immediately, so a restored panel never overstates the time left.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (status.kind !== "sent") return;
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [status.kind]);

  // One-shot: the bounced link is dead, so forget the stored request and
  // clean the address bar. The guard keeps parent re-renders from replaying
  // it; the notice itself renders from the initializer above.
  const errorConsumedRef = useRef(false);
  useEffect(() => {
    if (!linkError || errorConsumedRef.current) return;
    errorConsumedRef.current = true;
    clearLinkErrorParam();
    onSentCleared?.();
  }, [linkError, onSentCleared]);

  // Dev bypass: the server parked the link instead of emailing it. Read it
  // back once; state only changes from the promise callbacks, never inline.
  // One read per address: the link is single-use, and React's development
  // double-mount would otherwise spend it on the first call and then report an
  // expiry that never happened.
  const devReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!devSignIn || status.kind !== "sent") return;
    const email = status.email;
    if (devReadRef.current === email) return;
    devReadRef.current = email;
    let cancelled = false;
    fetch(`/api/dev/magic-link?email=${encodeURIComponent(email)}`, { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { url?: string }) : null
      )
      .then((body) => {
        if (!cancelled) setDevLink({ email, url: body?.url ?? null });
      })
      .catch(() => {
        if (!cancelled) setDevLink({ email, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [devSignIn, status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({ email, callbackURL });
    if (error) {
      setStatus({
        kind: "error",
        message:
          (typeof error.message === "string" && error.message) ||
          "Could not send the sign-in link. Please try again.",
      });
      return;
    }
    const sent = { email, sentAt: Date.now() };
    // A fresh request earns a fresh read: the previous link is spent.
    devReadRef.current = null;
    setDevLink(null);
    setStatus({ kind: "sent", ...sent });
    onSent?.(sent);
  }

  function resetToIdle() {
    onSentCleared?.();
    setLinkError(false);
    devReadRef.current = null;
    setDevLink(null);
    setStatus({ kind: "idle" });
  }

  if (status.kind === "sent") {
    if (devSignIn) {
      const settling = devLink?.email !== status.email;
      const url = settling ? null : devLink.url;
      return (
        <div className="rounded-xl border border-dashed border-stone-400 bg-surface-50 p-4 text-sm text-ink-700">
          <p className="font-medium">Development sign-in — no email was sent</p>
          <p className="mt-1">
            <code className="rounded bg-surface-200 px-1 py-0.5 text-[12px]">DEV_SIGN_IN_BYPASS</code>{" "}
            is on, so the one-time link for <span className="font-medium">{status.email}</span> is
            shown here instead of being emailed. It expires in 5 minutes.
          </p>
          {settling ? (
            <p className="mt-3 text-ink-500">Preparing the link…</p>
          ) : url ? (
            <a
              href={url}
              className="mt-3 inline-block rounded-lg bg-surface-900 px-4 py-2 text-sm font-semibold text-white hover:bg-surface-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
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
            onClick={resetToIdle}
          >
            Use a different email
          </button>
        </div>
      );
    }

    const expiry = linkExpiryCopy(status.sentAt, now ?? status.sentAt);
    return (
      <div className="rounded-xl border border-success-200 bg-success-50 p-4 text-sm text-success-900">
        <p className="font-medium">Check your email</p>
        <p className="mt-1">
          We sent a one-time sign-in link to <span className="font-medium">{status.email}</span>.{" "}
          {expiry.expired
            ? "That link has expired — send a fresh one below."
            : `${expiry.text} If it doesn't arrive, check your spam folder.`}
        </p>
        <button
          type="button"
          className="mt-3 font-medium underline underline-offset-2 hover:text-success-950"
          onClick={resetToIdle}
        >
          {expiry.expired ? "Send a fresh link" : "Use a different email"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {linkError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-800"
        >
          That sign-in link didn&apos;t work — it may have expired or been used already. Send
          yourself a fresh one below.
        </p>
      ) : null}
      <label htmlFor={inputId} className="text-sm font-medium text-ink-700">
        Email address
      </label>
      <input
        id={inputId}
        type="email"
        required
        autoComplete="email"
        placeholder="you@cafe.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
      />
      {status.kind === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-800"
        >
          {status.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
      >
        {status.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}

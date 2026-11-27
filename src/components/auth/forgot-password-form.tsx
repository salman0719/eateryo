"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

/**
 * Forgot-password form (P5) — self-serve reset request.
 *
 * The sent panel always shows the same sentence, whatever the address
 * named (plan Q1): the server answers 200 for unknown, link-only, and
 * password addresses alike, so this screen cannot oracle which addresses
 * exist. Kept in sync with `FORGOT_RESPONSE_COPY` in
 * `src/app/api/password/forgot/route.ts` — the server owns the wording,
 * this is its echo after a 200.
 */
const SENT_COPY = "If that address can reset, a link is on its way.";

type Status =
  { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const emailId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setStatus({ kind: "error", message: "Enter your email address." });
      return;
    }
    setStatus({ kind: "sending" });
    let response: Response;
    try {
      response = await fetch("/api/password/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Try again." });
      return;
    }
    if (!response.ok) {
      let serverMessage: string | null = null;
      try {
        const payload = (await response.json()) as { error?: { message?: unknown } };
        if (typeof payload.error?.message === "string") serverMessage = payload.error.message;
      } catch {
        serverMessage = null;
      }
      setStatus({
        kind: "error",
        message: serverMessage ?? "Could not request a reset link. Try again.",
      });
      return;
    }
    setStatus({ kind: "sent" });
  }

  if (status.kind === "sent") {
    return (
      <div className="rounded-xl border border-line-200 bg-surface-base p-4 text-sm text-ink-700">
        <p className="flex items-center gap-2 font-medium text-ink-900">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success-700" />
          Check your email
        </p>
        <p className="mt-1">{SENT_COPY} The link works once and expires in 30 minutes.</p>
        <p className="mt-2 text-ink-500">
          Nothing yet? Check spam, then{" "}
          <button
            type="button"
            onClick={() => setStatus({ kind: "idle" })}
            className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
          >
            send another
          </button>
          .
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor={emailId} className="text-sm font-medium text-ink-700">
          Email address
        </label>
        <input
          id={emailId}
          type="email"
          required
          autoComplete="email"
          placeholder="you@cafe.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </div>
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
        className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        {status.kind === "sending" ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-sm text-ink-500">
        Remembered it?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
        >
          Back to sign in
        </Link>
        .
      </p>
    </form>
  );
}

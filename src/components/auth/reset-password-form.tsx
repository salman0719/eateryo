"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";

import { passwordRuleStatus, passwordStrength, validateNewPassword } from "@/lib/auth/passwords";

/**
 * Reset-password form (P5) — spends the emailed link to set a new password.
 *
 * The rules checklist reads from the same module the server gate uses, so
 * the client feedback and the 400 copy can never disagree (the set-password
 * form's contract, reused). A dead link — unknown, expired, or spent —
 * answers the one failure copy, verbatim from the server, never which
 * case it was. Success signs out every other session, so the done panel
 * says so and points back at sign-in: nobody is signed in here.
 */
type Status =
  { kind: "idle" } | { kind: "saving" } | { kind: "done" } | { kind: "error"; message: string };

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const passwordId = useId();
  const confirmId = useId();

  const rules = useMemo(() => passwordRuleStatus(password, ""), [password]);
  const strength = useMemo(() => passwordStrength(password), [password]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = validateNewPassword(password, confirm, "");
    if (message) {
      setStatus({ kind: "error", message });
      return;
    }
    setStatus({ kind: "saving" });
    let response: Response;
    try {
      response = await fetch("/api/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirm }),
      });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Try again." });
      return;
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const serverMessage =
        typeof payload === "object" && payload !== null && "error" in payload
          ? (payload as { error?: { message?: unknown } }).error?.message
          : null;
      setStatus({
        kind: "error",
        message:
          typeof serverMessage === "string" && serverMessage
            ? serverMessage
            : "Could not set the password. Try again.",
      });
      return;
    }
    setStatus({ kind: "done" });
  }

  if (status.kind === "done") {
    return (
      <div className="rounded-xl border border-line-200 bg-surface-base p-4 text-sm text-ink-700">
        <p className="flex items-center gap-2 font-medium text-ink-900">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success-700" />
          Password set
        </p>
        <p className="mt-1">Your new password is active. Your other sessions were signed out.</p>
        <Link
          href="/sign-in"
          className="mt-3 inline-block font-medium text-accent-800 underline underline-offset-2"
        >
          Sign in with your new password
        </Link>
      </div>
    );
  }

  const ruleItems = [
    { ok: rules.longEnough, label: "10 characters or more" },
    { ok: rules.notEmail, label: "Not your email address" },
    { ok: rules.notCommon, label: "Not a commonly used password" },
  ];

  const inputClass =
    "w-full rounded-lg border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor={passwordId} className="text-sm font-medium text-ink-700">
          New password
        </label>
        <input
          id={passwordId}
          type={show ? "text" : "password"}
          required
          autoComplete="new-password"
          placeholder="At least 10 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={`mt-1 ${inputClass}`}
        />
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {ruleItems.map((rule) => (
            <li key={rule.label} className={rule.ok ? "text-success-800" : "text-ink-500"}>
              <span aria-hidden="true">{rule.ok ? "✓ " : "· "}</span>
              {rule.label}
            </li>
          ))}
        </ul>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-100" aria-hidden="true">
          <div
            className="h-full rounded-full bg-accent-600 transition-[width]"
            style={{ width: `${strength * 25}%` }}
          />
        </div>
      </div>
      <div>
        <label htmlFor={confirmId} className="text-sm font-medium text-ink-700">
          Confirm new password
        </label>
        <input
          id={confirmId}
          type={show ? "text" : "password"}
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <button
        type="button"
        onClick={() => setShow((value) => !value)}
        className="self-start text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
      >
        {show ? "Hide passwords" : "Show passwords"}
      </button>
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
        disabled={status.kind === "saving"}
        className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        {status.kind === "saving" ? "Setting…" : "Set new password"}
      </button>
    </form>
  );
}

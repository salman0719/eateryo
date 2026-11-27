"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Forced TOTP setup (P6) — scan, verify, save the recovery codes.
 *
 * Settled copy from the prototype: one scan and one code, ten single-use
 * recovery codes shown once and never again. No QR image dependency: the
 * manual key from the `otpauth://` URI is what authenticator apps accept
 * as typed entry, so it is rendered grouped for copying instead.
 * Server messages render verbatim; the enable response (URI + codes) is
 * held in component state and never written anywhere else.
 */
type Status =
  | { kind: "password" }
  | { kind: "enabling" }
  | { kind: "code"; totpUri: string; backupCodes: string[] }
  | { kind: "verifying"; totpUri: string; backupCodes: string[] }
  | { kind: "done"; backupCodes: string[] }
  | { kind: "error"; message: string; totpUri?: string; backupCodes?: string[] };

function secretOf(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function grouped(secret: string): string {
  return secret
    .replace(/\s/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

export function SetupTwoFactorForm({ callbackURL }: { callbackURL: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "password" });
  const passwordId = useId();
  const codeId = useId();
  const savedId = useId();

  const active =
    status.kind === "code" || status.kind === "verifying" || status.kind === "error"
      ? { totpUri: status.totpUri ?? "", backupCodes: status.backupCodes ?? [] }
      : null;

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "enabling" });
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || data?.method !== "totp" || !data.totpURI) {
      setStatus({
        kind: "error",
        message:
          typeof error?.message === "string" && error.message
            ? error.message
            : "Could not start setup. Check your password and try again.",
      });
      return;
    }
    setStatus({
      kind: "code",
      totpUri: data.totpURI,
      backupCodes: Array.isArray(data.backupCodes) ? data.backupCodes : [],
    });
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setStatus({ kind: "verifying", totpUri: active.totpUri, backupCodes: active.backupCodes });
    const { data, error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    if (error || !data) {
      setStatus({
        kind: "error",
        message:
          typeof error?.message === "string" && error.message
            ? error.message
            : "That code didn't work. Check your authenticator and try again.",
        totpUri: active.totpUri,
        backupCodes: active.backupCodes,
      });
      return;
    }
    setStatus({ kind: "done", backupCodes: active.backupCodes });
  }

  async function onCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600";

  if (status.kind === "done") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line-200 bg-surface-base p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success-700" />
          Two-factor is on
        </p>
        <p className="text-sm text-ink-700">
          Save your recovery codes — each signs you in once if you lose your phone. They are shown
          once and never again.
        </p>
        <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm text-ink-900">
          {status.backupCodes.map((backup) => (
            <li
              key={backup}
              className="rounded-lg border border-line-200 bg-surface-50 px-2 py-1 text-center"
            >
              {backup}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onCopy(status.backupCodes.join("\n"))}
          className="self-start text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
        >
          {copied ? "Copied" : "Copy codes"}
        </button>
        <label htmlFor={savedId} className="flex items-start gap-2 text-sm text-ink-700">
          <input
            id={savedId}
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="mt-0.5"
          />
          I&apos;ve saved them somewhere I can reach without this phone.
        </label>
        <button
          type="button"
          disabled={!saved}
          onClick={() => router.push(callbackURL)}
          className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          Continue to the operator panel
        </button>
      </div>
    );
  }

  if (active) {
    const secret = secretOf(active.totpUri);
    return (
      <form onSubmit={onVerify} className="flex flex-col gap-3" noValidate>
        <ol className="flex flex-col gap-1.5 rounded-xl border border-line-200 bg-surface-base p-4 text-sm text-ink-700">
          <li>
            <strong>Scan the code</strong> — use any authenticator app.
          </li>
          <li>
            <strong>Enter the 6 digits</strong> — they change every 30 seconds.
          </li>
          <li>
            <strong>Save the recovery codes</strong> — ten single-use codes, shown once.
          </li>
        </ol>
        <div className="rounded-xl border border-line-200 bg-surface-base p-4">
          <p className="text-xs font-medium text-ink-500">Can&apos;t scan? Enter this key:</p>
          <p className="mt-1 font-mono text-sm text-ink-900">{grouped(secret)}</p>
          <button
            type="button"
            onClick={() => onCopy(secret)}
            className="mt-1 text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
          >
            {copied ? "Copied" : "Copy key"}
          </button>
        </div>
        <div>
          <label htmlFor={codeId} className="text-sm font-medium text-ink-700">
            Authentication code
          </label>
          <input
            id={codeId}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`mt-1 ${inputClass} font-mono tracking-widest`}
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
          disabled={status.kind === "verifying"}
          className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          {status.kind === "verifying" ? "Verifying…" : "Verify and turn on"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onEnable} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor={passwordId} className="text-sm font-medium text-ink-700">
          Confirm your password
        </label>
        <input
          id={passwordId}
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
        disabled={status.kind === "enabling"}
        className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        {status.kind === "enabling" ? "Starting…" : "Start setup"}
      </button>
    </form>
  );
}

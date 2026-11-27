"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Second-factor challenge (P6) — the TOTP door and the recovery-code door.
 *
 * Settled copy from the prototype: five wrong codes pause sign-in for 15
 * minutes like a wrong password, and a recovery code still works while
 * paused — it is the way through. A spent recovery code answers the one
 * failure copy, never which case it was; with no codes left, another
 * operator's reset is the path, then the next sign-in sets up a new
 * authenticator.
 */
type Mode = "totp" | "recovery";

type Status = { kind: "idle" } | { kind: "verifying" } | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-lg border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600";

function TotpForm({
  callbackURL,
  onUseRecovery,
}: {
  callbackURL: string;
  onUseRecovery: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const codeId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "verifying" });
    try {
      const { data, error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (error || !data) {
        setStatus({
          kind: "error",
          message:
            typeof error?.message === "string" && error.message
              ? error.message
              : "That code didn't work. Check your authenticator and try again.",
        });
        return;
      }
      router.push(callbackURL);
      router.refresh();
      return;
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Try again." });
      return;
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
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
        {status.kind === "verifying" ? "Verifying…" : "Verify and continue"}
      </button>
      <p className="text-xs text-ink-500">
        Five wrong codes pause sign-in for 15 minutes, like a wrong password. A recovery code still
        works while paused.
      </p>
      <button
        type="button"
        onClick={onUseRecovery}
        className="self-start rounded-lg border border-line-300 bg-surface-base px-4 py-2 text-sm font-semibold text-ink-800 transition-colors hover:bg-surface-100"
      >
        Use a recovery code
      </button>
    </form>
  );
}

function RecoveryForm({ callbackURL, onBack }: { callbackURL: string; onBack: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const codeId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "verifying" });
    try {
      const { data, error } = await authClient.twoFactor.verifyBackupCode({ code: code.trim() });
      if (error || !data) {
        setStatus({
          kind: "error",
          message:
            typeof error?.message === "string" && error.message
              ? error.message
              : "That code didn't work. Check it and try again.",
        });
        return;
      }
      router.push(callbackURL);
      router.refresh();
      return;
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor={codeId} className="text-sm font-medium text-ink-700">
          Recovery code
        </label>
        <input
          id={codeId}
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className={`mt-1 ${inputClass} font-mono`}
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
        {status.kind === "verifying" ? "Verifying…" : "Sign in with this code"}
      </button>
      <p className="text-xs text-ink-500">
        Each code works once. No codes left? Another operator resets your second factor from the
        operator panel — then your next sign-in sets up a new authenticator.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
      >
        Back to the authenticator code
      </button>
    </form>
  );
}

export function FactorScreen({ callbackURL }: { callbackURL: string }) {
  const [mode, setMode] = useState<Mode>("totp");
  return mode === "totp" ? (
    <TotpForm callbackURL={callbackURL} onUseRecovery={() => setMode("recovery")} />
  ) : (
    <RecoveryForm callbackURL={callbackURL} onBack={() => setMode("totp")} />
  );
}

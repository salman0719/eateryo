"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Password sign-in form (P3) — the password door beside the emailed link.
 *
 * Settled copy from the prototype: one failure sentence for an unknown
 * address, an account with no password, and a wrong password, so the page
 * never says which accounts exist. A correct password on a suspended
 * account lands on `/suspended` through the shared generic copy; the
 * suspension reason never reaches this screen.
 *
 * P4 adds the pause: five failed attempts lock the account for 15 minutes,
 * and the server answers 429 with the settled pause copy (minutes left, and
 * the emailed link as the way through). The screen renders that copy
 * verbatim — it is the server's sentence, not a second opinion — and offers
 * the link door, which the counter never gates.
 *
 * P6 adds the handoff: an operator with a second factor answers the
 * password correctly but has no session yet, so the server redirects the
 * flow to the challenge screen (`/sign-in/factor`), keeping `?next=`.
 */
export function PasswordSignInForm({
  callbackURL,
  onUseLink,
}: {
  callbackURL: string;
  /** Switch to the emailed-link door (the escape hatch while paused). */
  onUseLink: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "signing-in" }
    | { kind: "error"; message: string }
    | { kind: "locked"; message: string }
  >({ kind: "idle" });
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setStatus({
        kind: "error",
        message: "That email and password don't match. Check them and try again.",
      });
      return;
    }
    setStatus({ kind: "signing-in" });
    const { data, error } = await authClient.signIn.email({
      email: email.trim(),
      password,
      callbackURL,
    });
    if (error) {
      const statusCode = typeof error.status === "number" ? error.status : null;
      if (statusCode === 429) {
        setStatus({
          kind: "locked",
          message:
            typeof error.message === "string" && error.message
              ? error.message
              : "Too many attempts. Sign-in for this account is paused for 15 minutes — wait, or email yourself a sign-in link instead.",
        });
        return;
      }
      if (statusCode === 403) {
        router.push("/suspended");
        return;
      }
      setStatus({
        kind: "error",
        message: "That email and password don't match. Check them and try again.",
      });
      return;
    }
    // Second factor pending (P6): no session yet, so continue on the
    // challenge screen instead of the callback.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push(`/sign-in/factor?next=${encodeURIComponent(callbackURL)}`);
      return;
    }
    if (data) {
      router.push(callbackURL);
      router.refresh();
      return;
    }
    setStatus({
      kind: "error",
      message: "That email and password don't match. Check them and try again.",
    });
  }

  const inputClass =
    "w-full rounded-lg border border-line-300 bg-surface-base px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600";

  if (status.kind === "locked") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900">
        <p role="alert" className="font-medium">
          Too many attempts
        </p>
        <p>{status.message}</p>
        <button
          type="button"
          onClick={onUseLink}
          className="self-start rounded-lg border border-line-300 bg-surface-base px-4 py-2 text-sm font-semibold text-ink-800 transition-colors hover:bg-surface-100"
        >
          Email me a sign-in link instead
        </button>
        <button
          type="button"
          onClick={() => setStatus({ kind: "idle" })}
          className="self-start text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
        >
          Try again
        </button>
      </div>
    );
  }

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
          autoComplete="username"
          placeholder="you@cafe.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor={passwordId} className="text-sm font-medium text-ink-700">
            Password
          </label>
          <Link
            href="/sign-in/forgot"
            className="text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
          >
            Forgot your password?
          </Link>
        </div>
        <div className="mt-1 flex gap-2">
          <input
            id={passwordId}
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            className="shrink-0 rounded-lg border border-line-300 px-3 text-sm font-medium text-ink-600 hover:text-ink-900"
            aria-pressed={show}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
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
        disabled={status.kind === "signing-in"}
        className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        {status.kind === "signing-in" ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

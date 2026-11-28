"use client";

import { useState } from "react";

import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { PasswordSignInForm } from "@/components/auth/password-sign-in-form";

/** A link verification the server bounced back here with `?error=…`. */
function readErrorParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("error") !== null;
  } catch {
    return false;
  }
}

/**
 * Sign-in screen state (P3) — the password door first, the emailed link as
 * the second door. A first visit still starts with a link (no
 * create-account form, sign-in never mints), and the cutover copy lives
 * here so a link-only account knows a password can follow verification.
 */
export function SignInScreen({
  callbackURL,
  devSignIn,
}: {
  callbackURL: string;
  devSignIn: boolean;
}) {
  // A bounced link lands here with `?error=link`, and its explanation plus
  // resend path live behind the link door — so arrive with that door open
  // instead of a password form that says nothing about the dead link.
  const [mode, setMode] = useState<"password" | "link">(() =>
    readErrorParam() ? "link" : "password"
  );

  return (
    <div className="flex flex-col gap-3">
      {mode === "password" ? (
        <>
          <PasswordSignInForm callbackURL={callbackURL} onUseLink={() => setMode("link")} />
          <div className="flex items-center gap-3 text-xs text-ink-500" aria-hidden="true">
            <span className="h-px flex-1 bg-line-200" />
            <span>or</span>
            <span className="h-px flex-1 bg-line-200" />
          </div>
          <button
            type="button"
            onClick={() => setMode("link")}
            className="rounded-lg border border-line-300 bg-surface-base px-4 py-2 text-sm font-semibold text-ink-800 transition-colors hover:bg-surface-100"
          >
            Email me a sign-in link instead
          </button>
          <p className="text-sm text-ink-500">
            First time here? A sign-in link sets your account up — you can choose a password
            straight after.
          </p>
        </>
      ) : (
        <>
          <MagicLinkForm callbackURL={callbackURL} devSignIn={devSignIn} />
          <div className="flex items-center gap-3 text-xs text-ink-500" aria-hidden="true">
            <span className="h-px flex-1 bg-line-200" />
            <span>or</span>
            <span className="h-px flex-1 bg-line-200" />
          </div>
          <button
            type="button"
            onClick={() => setMode("password")}
            className="rounded-lg border border-line-300 bg-surface-base px-4 py-2 text-sm font-semibold text-ink-800 transition-colors hover:bg-surface-100"
          >
            Use my password instead
          </button>
        </>
      )}
    </div>
  );
}

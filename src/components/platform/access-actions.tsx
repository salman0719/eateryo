/**
 * Force-reset and unlock actions for one account (B4) — the operator
 * side of password sign-in.
 *
 * A client island on the server-rendered detail page: forcing a reset
 * posts to the access route (no body — the action carries no
 * parameters), revokes the account's sessions, and refreshes the page
 * so the chip and the log read back from the server. Unlock posts the
 * same way and clears the lockout. The emailed 30-minute link ships
 * with the password work, not V1, and the confirm copy says so — no
 * operator mistakes this for a sent email.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AccessChip } from "@/features/platform/schema";

interface ResetState {
  confirming: boolean;
  pending: boolean;
  error: string | null;
  result: string | null;
}

const INITIAL_RESET: ResetState = {
  confirming: false,
  pending: false,
  error: null,
  result: null,
};

function errorMessage(body: { error?: { message?: string } }): string {
  if (typeof body.error?.message === "string" && body.error.message) return body.error.message;
  return "Something went wrong. Try again.";
}

export function AccessActions({
  accountId,
  accountName,
  chip,
}: {
  accountId: string;
  accountName: string;
  chip: AccessChip;
}) {
  const router = useRouter();
  const [reset, setReset] = useState<ResetState>(INITIAL_RESET);
  const [unlockPending, setUnlockPending] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  async function submitReset(): Promise<void> {
    setReset((state) => ({ ...state, pending: true, error: null, result: null }));
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(accountId)}/access/reset`,
        { method: "POST" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        sessionsRevoked?: number;
      };
      if (!response.ok) {
        setReset((state) => ({ ...state, pending: false, error: errorMessage(body) }));
        return;
      }
      const revoked = typeof body.sessionsRevoked === "number" ? body.sessionsRevoked : 0;
      setReset({
        confirming: false,
        pending: false,
        error: null,
        result: `${accountName} must set a new password at next sign-in — ${revoked} active session${revoked === 1 ? "" : "s"} revoked. The emailed link ships with password sign-in.`,
      });
      router.refresh();
    } catch {
      setReset((state) => ({
        ...state,
        pending: false,
        error: "Something went wrong. Try again.",
      }));
    }
  }

  async function submitUnlock(): Promise<void> {
    setUnlockPending(true);
    setUnlockError(null);
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(accountId)}/access/unlock`,
        { method: "POST" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setUnlockPending(false);
        setUnlockError(errorMessage(body));
        return;
      }
      setUnlockPending(false);
      router.refresh();
    } catch {
      setUnlockPending(false);
      setUnlockError("Something went wrong. Try again.");
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {chip === "locked" ? (
        <div>
          <button
            type="button"
            onClick={submitUnlock}
            disabled={unlockPending}
            className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {unlockPending ? "Unlocking…" : "Unlock sign-in"}
          </button>
          {unlockError ? (
            <p role="alert" className="mt-2 text-xs font-medium text-danger-700">
              {unlockError}
            </p>
          ) : null}
        </div>
      ) : null}
      <div>
        {reset.result ? (
          <p role="status" className="text-sm text-ink-600">
            {reset.result}
          </p>
        ) : null}
        {reset.confirming ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line-200 p-3">
            <p className="text-xs text-ink-600">
              <strong>Force a new password?</strong> This revokes every active session — an open tab
              stops working immediately — and the account must set a new password at next sign-in.
              The emailed link itself ships with password sign-in; nothing is emailed by this
              action.
            </p>
            {reset.error ? (
              <p role="alert" className="text-xs font-medium text-danger-700">
                {reset.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitReset}
                disabled={reset.pending}
                className="rounded-lg bg-danger-700 px-4 py-2 text-sm font-semibold text-on-accent hover:bg-danger-800 disabled:opacity-50"
              >
                {reset.pending ? "Forcing…" : "Force password reset"}
              </button>
              <button
                type="button"
                onClick={() => setReset((state) => ({ ...state, confirming: false, error: null }))}
                className="rounded-lg border border-line-200 px-4 py-2 text-sm font-medium text-ink-900"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReset((state) => ({ ...state, confirming: true }))}
            className="rounded-lg border border-line-200 px-4 py-2 text-sm font-medium text-ink-900"
          >
            Force password reset
          </button>
        )}
      </div>
    </div>
  );
}

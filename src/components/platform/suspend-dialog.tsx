/**
 * Suspend / restore actions for one account (B3) — one of the admin
 * panel's mutations, alongside the B4 force-reset and unlock actions.
 *
 * A client island on the server-rendered detail page: the dialog posts to
 * the existing suspension route (reason required, note ≤ 500, same guard
 * and `rejectCrossOrigin` as B1) and refreshes the page on success so the
 * banner, timeline and log read back from the server. The diner-safe copy
 * is the plan's Q1 answer verbatim: suspension stops the account, never
 * the cafés — published menus keep serving diners.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SUSPENSION_REASONS } from "@/lib/db/schema";

const REASON_LABELS: Record<(typeof SUSPENSION_REASONS)[number], string> = {
  abuse_or_spam: "Abuse or spam",
  owner_request: "Owner request",
  other: "Other",
};

interface SuspendState {
  open: boolean;
  reason: (typeof SUSPENSION_REASONS)[number];
  note: string;
  pending: boolean;
  error: string | null;
  result: string | null;
}

interface RestoreState {
  open: boolean;
  note: string;
  pending: boolean;
  error: string | null;
}

const INITIAL_SUSPEND: SuspendState = {
  open: false,
  reason: "abuse_or_spam",
  note: "",
  pending: false,
  error: null,
  result: null,
};

const INITIAL_RESTORE: RestoreState = {
  open: false,
  note: "",
  pending: false,
  error: null,
};

function errorMessage(status: number, body: { error?: { message?: string } }): string {
  if (typeof body.error?.message === "string" && body.error.message) return body.error.message;
  return status === 409 ? "That account is already suspended." : "Something went wrong. Try again.";
}

export function SuspendActions({
  accountId,
  accountName,
  suspended,
}: {
  accountId: string;
  accountName: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [suspend, setSuspend] = useState<SuspendState>(INITIAL_SUSPEND);
  const [restore, setRestore] = useState<RestoreState>(INITIAL_RESTORE);

  async function submitSuspend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSuspend((state) => ({ ...state, pending: true, error: null, result: null }));
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(accountId)}/suspension`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: suspend.reason,
            ...(suspend.note.trim() ? { note: suspend.note.trim() } : {}),
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        sessionsRevoked?: number;
      };
      if (!response.ok) {
        setSuspend((state) => ({
          ...state,
          pending: false,
          error: errorMessage(response.status, body),
        }));
        return;
      }
      const revoked = typeof body.sessionsRevoked === "number" ? body.sessionsRevoked : 0;
      setSuspend((state) => ({
        ...state,
        pending: false,
        open: false,
        note: "",
        result: `${accountName} is suspended — ${revoked} active session${revoked === 1 ? "" : "s"} revoked. Published menus keep serving diners.`,
      }));
      router.refresh();
    } catch {
      setSuspend((state) => ({
        ...state,
        pending: false,
        error: "Something went wrong. Try again.",
      }));
    }
  }

  async function submitRestore(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setRestore((state) => ({ ...state, pending: true, error: null }));
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(accountId)}/suspension`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(restore.note.trim() ? { note: restore.note.trim() } : {}),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setRestore((state) => ({
          ...state,
          pending: false,
          error: errorMessage(response.status, body),
        }));
        return;
      }
      setRestore(INITIAL_RESTORE);
      router.refresh();
    } catch {
      setRestore((state) => ({
        ...state,
        pending: false,
        error: "Something went wrong. Try again.",
      }));
    }
  }

  if (suspended) {
    return (
      <div>
        {restore.open ? (
          <form
            onSubmit={submitRestore}
            className="mt-3 flex flex-col gap-3 rounded-xl border border-line-200 p-3"
          >
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              Restore note (optional)
              <textarea
                name="note"
                rows={2}
                maxLength={500}
                value={restore.note}
                onChange={(event) =>
                  setRestore((state) => ({ ...state, note: event.target.value }))
                }
                placeholder="Why is access being restored?"
                className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
              />
            </label>
            <p className="text-xs text-ink-600">
              Restoring lets this account sign in again immediately. The suspension stays in the
              operator log with its reason.
            </p>
            {restore.error ? (
              <p role="alert" className="text-xs font-medium text-danger-700">
                {restore.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={restore.pending}
                className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {restore.pending ? "Restoring…" : "Restore access"}
              </button>
              <button
                type="button"
                onClick={() => setRestore(INITIAL_RESTORE)}
                className="rounded-lg border border-line-200 px-4 py-2 text-sm font-medium text-ink-900"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setRestore((state) => ({ ...state, open: true }))}
            className="mt-3 rounded-lg border border-line-200 px-4 py-2 text-sm font-medium text-ink-900"
          >
            Restore access
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {suspend.result ? (
        <p role="status" className="mt-3 text-sm text-ink-600">
          {suspend.result}
        </p>
      ) : null}
      {suspend.open ? (
        <form
          onSubmit={submitSuspend}
          className="mt-3 flex flex-col gap-3 rounded-xl border border-line-200 p-3"
        >
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            Reason (required)
            <select
              name="reason"
              value={suspend.reason}
              onChange={(event) =>
                setSuspend((state) => ({
                  ...state,
                  reason: event.target.value as SuspendState["reason"],
                }))
              }
              className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
            >
              {SUSPENSION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            Note (optional, internal)
            <textarea
              name="note"
              rows={3}
              maxLength={500}
              value={suspend.note}
              onChange={(event) => setSuspend((state) => ({ ...state, note: event.target.value }))}
              placeholder="What happened, and what would let us restore this account?"
              className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
            />
          </label>
          <p className="rounded-lg bg-surface-100 px-3 py-2 text-xs text-ink-600">
            <strong>Diners are not affected.</strong> Published menus keep serving table orders;
            suspension only stops the account signing in. The reason and note stay internal, and
            restoring is one click — also logged.
          </p>
          {suspend.error ? (
            <p role="alert" className="text-xs font-medium text-danger-700">
              {suspend.error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={suspend.pending}
              className="rounded-lg bg-danger-700 px-4 py-2 text-sm font-semibold text-on-accent hover:bg-danger-800 disabled:opacity-50"
            >
              {suspend.pending ? "Suspending…" : "Suspend account"}
            </button>
            <button
              type="button"
              onClick={() => setSuspend((state) => ({ ...state, open: false, error: null }))}
              className="rounded-lg border border-line-200 px-4 py-2 text-sm font-medium text-ink-900"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setSuspend((state) => ({ ...state, open: true }))}
          className="mt-3 rounded-lg bg-danger-700 px-4 py-2 text-sm font-semibold text-on-accent hover:bg-danger-800"
        >
          Suspend account
        </button>
      )}
    </div>
  );
}

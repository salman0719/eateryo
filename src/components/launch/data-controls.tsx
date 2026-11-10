"use client";

/**
 * Account export and account deletion, both rendered by Settings.
 *
 * Export is a neutral card ("Data & privacy") because it is a data right,
 * not a hazard — it must not sit inside a red block. Deletion is the final
 * danger zone on the page: it removes the account and every restaurant the
 * account created, then signs out. Its confirm phrase is deliberate, because
 * its blast radius is larger than deleting one café.
 *
 * Both cards self-gate on the session, so a signed-out visitor sees nothing
 * rather than buttons whose APIs would 401. While the session is still
 * resolving they render, exactly as before, because Settings only mounts
 * them for a signed-in account.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SyncError } from "@/features/menus/sync";
import { deleteAccount, downloadAccountExport } from "@/features/retention/client";
import { authClient } from "@/lib/auth-client";

const CONFIRM_PHRASE = "delete my account";

function describeFailure(failure: unknown): string {
  if (failure instanceof SyncError) return failure.message;
  return failure instanceof Error ? failure.message : "Something went wrong. Try again.";
}

/** Export everything the account can see as a JSON download. */
export function AccountExportCard() {
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Below the hooks: a signed-out visitor (or a still-resolving session)
  // sees nothing rather than buttons whose APIs would 401.
  if (!isPending && !session?.user) return null;

  async function handleExport() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await downloadAccountExport();
      setMessage("Your export downloaded as a JSON file.");
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="data" className="rounded-2xl border border-line-200 bg-surface-base p-5">
      <h3 className="text-sm font-bold tracking-tight text-ink-900">Data & privacy</h3>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        Download everything this account can see as a JSON file.
      </p>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={busy}
          className="rounded-lg border border-line-300 bg-surface-base px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          {busy ? "Preparing…" : "Export my data"}
        </button>
      </div>

      {message ? (
        <p role="status" className="mt-3 text-sm text-success-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The last block on the Settings page. Nothing but page-level links belongs
 * below it: every settings section is a reason to scroll past a destructive
 * control, and this is the most destructive control in the product.
 */
export function AccountDangerZone() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  // Same gate as the export card; hooks stay above the early return.
  if (!isPending && !session?.user) return null;

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      try {
        await authClient.signOut();
      } catch {
        // The session row is already gone with the user.
      }
      // Replace the history entry: the deleted account should not be one
      // "back" away, and the editor must re-render as signed out.
      router.replace("/");
      router.refresh();
    } catch (failure) {
      setError(describeFailure(failure));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-danger-200 bg-danger-50 p-5">
      <h3 className="text-sm font-bold tracking-tight text-danger-900">
        Danger zone — delete your account
      </h3>
      <p className="mt-1 text-xs leading-5 text-danger-800">
        Deleting the account also deletes every restaurant it created, with its menus, published
        pages and order history. Export first if you want a copy. There is no undo.
      </p>

      {confirming ? (
        <div className="mt-3 rounded-xl border border-danger-200 bg-surface-base p-3">
          <label className="block text-xs font-medium text-danger-900">
            Type “{CONFIRM_PHRASE}” to confirm
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-danger-300 bg-surface-base px-2.5 py-1.5 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-600"
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy || confirmText.trim().toLowerCase() !== CONFIRM_PHRASE}
              className="rounded-lg bg-danger-700 px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-danger-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              className="rounded-lg px-2 py-1.5 text-sm text-ink-600 hover:text-ink-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          className="mt-3 rounded-lg border border-danger-200 bg-surface-base px-3 py-1.5 text-sm font-medium text-danger-700 hover:bg-danger-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-600"
        >
          Delete my account
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

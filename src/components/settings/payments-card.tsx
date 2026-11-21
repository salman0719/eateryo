"use client";

/**
 * Settings → Payments (Commit 2, owner-only writes).
 *
 * Seven states from the research notes: choose, stripe-details, connecting,
 * pending, active, restricted, venue. Staff see the status; the controls are
 * absent, not disabled-with-a-tooltip. Signed-out visitors never reach here
 * (the page gates them); signed-out API calls get 401 with no provider
 * detail.
 *
 * Custody copy (the one sentence every state keeps): the money goes to the
 * café's Stripe account; Eateryo never holds it.
 */

import { useEffect, useState } from "react";

import {
  checkPaymentsNow,
  disableOnlinePayments,
  fetchPaymentsStatus,
  refreshPaymentsLink,
  setPaymentsMode,
  startPaymentsConnect,
  type PaymentsAccount,
} from "@/features/payments/client";
import { SyncError } from "@/features/menus/sync";

type CardState =
  | "loading"
  | "choose"
  | "stripe-details"
  | "connecting"
  | "pending"
  | "active"
  | "restricted"
  | "venue";

function describeFailure(failure: unknown): string {
  if (failure instanceof SyncError) return failure.message;
  return failure instanceof Error ? failure.message : "Something went wrong. Try again.";
}

function stateFor(account: PaymentsAccount | null, details: boolean): CardState {
  if (!account) return details ? "stripe-details" : "choose";
  if (account.status === "pending") return "pending";
  if (account.status === "restricted" || account.status === "unavailable") return "restricted";
  if (account.mode === "online" && account.status === "active") return "active";
  return "venue";
}

export function PaymentsCard({
  restaurantId,
  restaurantName,
  canManage = true,
}: {
  restaurantId: string;
  restaurantName: string;
  canManage?: boolean;
}) {
  const [account, setAccount] = useState<PaymentsAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const status = await fetchPaymentsStatus(restaurantId);
        if (!cancelled) setAccount(status);
      } catch (failure) {
        if (!cancelled) setError(describeFailure(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  // Stripe returns here after onboarding; re-read Stripe instead of the cache.
  useEffect(() => {
    if (typeof window === "undefined" || !canManage) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payments") !== "return" && params.get("payments") !== "refresh") return;
    if (params.get("restaurant") !== restaurantId) return;
    void (async () => {
      try {
        setAccount(await checkPaymentsNow(restaurantId));
        setNotice("Checked with Stripe just now.");
      } catch (failure) {
        setError(describeFailure(failure));
      }
    })();
  }, [restaurantId, canManage]);

  async function handleConnect() {
    if (busy || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      const link = account
        ? await refreshPaymentsLink(restaurantId)
        : await startPaymentsConnect(restaurantId);
      window.location.href = link.url;
    } catch (failure) {
      setError(describeFailure(failure));
      setBusy(false);
    }
  }

  async function handleCheck() {
    if (busy || !canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setAccount(await checkPaymentsNow(restaurantId));
      setNotice("Checked with Stripe just now.");
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleMode(mode: "online" | "at_venue") {
    if (busy || !canManage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setAccount(await setPaymentsMode(restaurantId, mode));
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (busy || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      setAccount(await disableOnlinePayments(restaurantId));
      setNotice("Card payment is off — diners see pay at the counter.");
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const state: CardState = loading ? "loading" : stateFor(account, details);

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
      <h3 className="text-sm font-bold tracking-tight text-ink-900">Card payments</h3>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        Take table-order card payment on {restaurantName}&rsquo;s own Stripe account. The money goes
        to your Stripe account; Eateryo never holds it.
      </p>

      {state === "loading" && (
        <p role="status" className="mt-3 text-xs text-ink-500">
          Loading card payments…
        </p>
      )}

      {!loading && !canManage && (
        <p className="mt-3 text-xs leading-5 text-ink-500">
          {account?.mode === "online" && account.status === "active"
            ? "Card payment is on — diners can pay by card."
            : "Diners pay at the counter for now."}{" "}
          Only an owner can change this.
        </p>
      )}

      {state === "choose" && canManage && (
        <div className="mt-3">
          <p className="text-xs leading-5 text-ink-500">
            Diners pay at the counter today — cash, EFTPOS or on collection. Connect Stripe to also
            take cards at the table.
          </p>
          <button
            type="button"
            onClick={() => setDetails(true)}
            className="mt-3 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Set up card payment
          </button>
        </div>
      )}

      {state === "stripe-details" && canManage && (
        <div className="mt-3">
          <ol className="list-decimal pl-5 text-xs leading-5 text-ink-500">
            <li>
              We create your café&rsquo;s Stripe account (one per café, reused if you reconnect).
            </li>
            <li>Stripe walks you through identity and payout details on their page.</li>
            <li>
              You return here — card payment turns on only when Stripe says the account can charge.
            </li>
          </ol>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={busy}
              className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              {busy ? "Opening Stripe…" : "Continue to Stripe"}
            </button>
            <button
              type="button"
              onClick={() => setDetails(false)}
              disabled={busy}
              className="rounded-full border border-line-200 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-surface-base disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state === "connecting" && (
        <p role="status" className="mt-3 text-xs text-ink-500">
          Opening Stripe…
        </p>
      )}

      {state === "pending" && (
        <div className="mt-3">
          <p className="text-xs leading-5 text-warning-800">
            Waiting on Stripe — finish the setup on their page. Diners still pay at the counter
            until then.
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={busy}
                className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-800 disabled:opacity-50"
              >
                Finish setup
              </button>
              <button
                type="button"
                onClick={() => void handleCheck()}
                disabled={busy}
                className="rounded-full border border-line-200 px-4 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
              >
                Check again
              </button>
            </div>
          )}
        </div>
      )}

      {state === "restricted" && (
        <div className="mt-3">
          <p className="text-xs leading-5 text-danger-700">
            Action needed — Stripe paused card payment for this account. No money is stuck; diners
            pay at the counter until it&rsquo;s fixed.
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={busy}
                className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-800 disabled:opacity-50"
              >
                Fix in Stripe
              </button>
              <button
                type="button"
                onClick={() => void handleCheck()}
                disabled={busy}
                className="rounded-full border border-line-200 px-4 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
              >
                Check again
              </button>
            </div>
          )}
        </div>
      )}

      {state === "active" && (
        <div className="mt-3">
          <p className="text-xs leading-5 text-ink-500">
            Card payment is on. Diners can pay by card at the table; the payout lands in your Stripe
            account, and refunds happen in your Stripe dashboard.
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleMode("at_venue")}
                disabled={busy}
                className="rounded-full border border-line-200 px-4 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
              >
                Use pay at the counter
              </button>
              <button
                type="button"
                onClick={() => void handleDisable()}
                disabled={busy}
                className="rounded-full border border-line-200 px-4 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
              >
                Turn off
              </button>
            </div>
          )}
        </div>
      )}

      {state === "venue" && (
        <div className="mt-3">
          <p className="text-xs leading-5 text-ink-500">
            {account?.status === "active"
              ? "Pay at the counter is on — your Stripe connection is kept, so turning cards back on needs no second setup."
              : "Diners pay at the counter."}{" "}
            What diners see now: pay at the counter.
          </p>
          {canManage && account?.status === "active" && (
            <button
              type="button"
              onClick={() => void handleMode("online")}
              disabled={busy}
              className="mt-3 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-800 disabled:opacity-50"
            >
              Turn card payment on
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-700">
          {error}
        </p>
      )}
      {notice && <p className="mt-3 text-xs text-ink-500">{notice}</p>}
    </div>
  );
}

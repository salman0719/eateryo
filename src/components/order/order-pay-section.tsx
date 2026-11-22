"use client";

/**
 * Diner card-payment section (Commit 3 slice 2).
 *
 * Lives in `OrderReceived`'s children slot, beside the tracker — no route
 * changes to grow the receipt. Anonymous like the order: the tracking token
 * is the only proof, and the payment-status route (not this component)
 * decides whether card payment is even offered.
 *
 * Every fallback lands somewhere honest: the resolver's own sentence for
 * the counter, a retry for a failure or a cancel, and a "confirming" state
 * for the webhook-lag window after a successful Stripe return.
 */

import { useEffect, useRef, useState } from "react";

import { fetchOrderPayment, startCheckout, type OrderPaymentRead } from "@/features/orders/client";
import { SyncError } from "@/features/menus/sync";

interface OrderPaySectionProps {
  orderId: string;
  trackingToken: string | null;
  /** From the Stripe return URL (`?pay=success|…&session_id=…`). */
  returnPay: "success" | "cancelled" | null;
  sessionId: string | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; copy: string }
  | { kind: "ready"; read: OrderPaymentRead };

const COUNTER_COPY = "Pay at the counter — cash, EFTPOS or on collection.";

/** Confirming poll schedule: 5 fast ticks, then 10 slow ticks (~60s total). */
export const CONFIRM_POLL_FAST_COUNT = 5;
export const CONFIRM_POLL_FAST_MS = 2000;
export const CONFIRM_POLL_SLOW_MS = 5000;
export const CONFIRM_POLL_MAX_ATTEMPTS = 15;

export function delayForConfirmPollAttempt(attempt: number): number {
  return attempt < CONFIRM_POLL_FAST_COUNT ? CONFIRM_POLL_FAST_MS : CONFIRM_POLL_SLOW_MS;
}

export function OrderPaySection({
  orderId,
  trackingToken,
  returnPay,
  sessionId,
}: OrderPaySectionProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    trackingToken ? { kind: "loading" } : { kind: "unavailable", copy: COUNTER_COPY }
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [checkingAgain, setCheckingAgain] = useState(false);
  const inFlightRef = useRef(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!trackingToken) return;
    let cancelled = false;
    attemptRef.current = 0;
    inFlightRef.current = true;
    void (async () => {
      // New order / link: restart the confirming poll from the first fast tick.
      if (!cancelled) {
        setPollCount(0);
        setExhausted(false);
        setCheckingAgain(false);
      }
      try {
        const read = await fetchOrderPayment(orderId, trackingToken, sessionId);
        if (!cancelled) setPhase({ kind: "ready", read });
      } catch {
        if (!cancelled) setPhase({ kind: "unavailable", copy: COUNTER_COPY });
      } finally {
        inFlightRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, trackingToken, sessionId]);

  const confirming =
    phase.kind === "ready" &&
    returnPay === "success" &&
    (phase.read.paymentStatus ?? "unpaid") !== "paid" &&
    (phase.read.paymentStatus ?? "unpaid") !== "refunded" &&
    phase.read.checkout.mode === "online" &&
    phase.read.checkout.reason !== "expired" &&
    phase.read.live?.paid === true;

  // Confirming poll: interval ticks fire on schedule and skip while the
  // previous read is still unresolved (no parallel reads, no out-of-order
  // writes). Skipped ticks never count toward the 15-attempt budget.
  useEffect(() => {
    if (!confirming || exhausted || !trackingToken) return;
    if (attemptRef.current >= CONFIRM_POLL_MAX_ATTEMPTS) {
      setExhausted(true);
      return;
    }
    let cancelled = false;
    const delay = delayForConfirmPollAttempt(attemptRef.current);
    const timer = setInterval(() => {
      if (cancelled) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      void (async () => {
        try {
          const read = await fetchOrderPayment(orderId, trackingToken, sessionId);
          if (cancelled) return;
          attemptRef.current += 1;
          setPollCount(attemptRef.current);
          setPhase({ kind: "ready", read });
          if (attemptRef.current >= CONFIRM_POLL_MAX_ATTEMPTS) setExhausted(true);
        } catch {
          if (cancelled) return;
          attemptRef.current += 1;
          setPollCount(attemptRef.current);
          if (attemptRef.current >= CONFIRM_POLL_MAX_ATTEMPTS) setExhausted(true);
        } finally {
          inFlightRef.current = false;
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [confirming, exhausted, orderId, trackingToken, sessionId, pollCount]);

  /** Hard-stop state: one manual re-read, then the schedule restarts. */
  async function checkAgain() {
    if (!trackingToken || checkingAgain || inFlightRef.current) return;
    setCheckingAgain(true);
    inFlightRef.current = true;
    try {
      const read = await fetchOrderPayment(orderId, trackingToken, sessionId);
      setPhase({ kind: "ready", read });
      const stillConfirming =
        returnPay === "success" &&
        (read.paymentStatus ?? "unpaid") !== "paid" &&
        (read.paymentStatus ?? "unpaid") !== "refunded" &&
        read.checkout.mode === "online" &&
        read.checkout.reason !== "expired" &&
        read.live?.paid === true;
      if (stillConfirming) {
        attemptRef.current = 0;
        setPollCount(0);
        setExhausted(false);
      } else {
        setExhausted(true);
      }
    } catch {
      attemptRef.current = 0;
      setPollCount(0);
      setExhausted(false);
    } finally {
      inFlightRef.current = false;
      setCheckingAgain(false);
    }
  }

  /** Re-read after a conflict (paid since the receipt loaded) — event paths only. */
  async function refresh() {
    if (!trackingToken) return;
    try {
      const read = await fetchOrderPayment(orderId, trackingToken, sessionId);
      setPhase({ kind: "ready", read });
    } catch {
      setPhase({ kind: "unavailable", copy: COUNTER_COPY });
    }
  }

  async function begin() {
    if (!trackingToken || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const started = await startCheckout(orderId, trackingToken);
      window.location.href = started.url;
    } catch (error) {
      if (error instanceof SyncError && error.code === "conflict") {
        // Paid since the receipt loaded — re-read instead of minting.
        await refresh();
        setStarting(false);
        return;
      }
      setStartError(
        error instanceof SyncError
          ? error.message
          : "Card payment is unavailable right now. Pay at the counter."
      );
      setStarting(false);
    }
  }

  if (phase.kind === "loading") {
    return (
      <div
        className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-raised p-5 text-left"
        aria-busy="true"
      >
        <p className="text-sm text-ink-500">Checking card payment…</p>
      </div>
    );
  }

  if (phase.kind === "unavailable") {
    return (
      <div className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-raised p-5 text-left">
        <p className="text-sm text-ink-600">{phase.copy}</p>
      </div>
    );
  }

  const { read } = phase;
  const stored = read.paymentStatus ?? "unpaid";

  // The money already moved (or came back): a finished state, not an action.
  if (stored === "paid") {
    return (
      <div className="mx-auto mt-5 max-w-md rounded-2xl border border-success-300 bg-success-50 p-5 text-left">
        <p className="text-sm font-semibold text-success-800">Paid — thank you.</p>
        <p className="mt-1 text-xs text-ink-600">
          Your card payment went through to the café. Keep this screen for your records.
        </p>
      </div>
    );
  }
  if (stored === "refunded") {
    return (
      <div className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-raised p-5 text-left">
        <p className="text-sm font-semibold text-ink-900">Payment refunded.</p>
        <p className="mt-1 text-xs text-ink-600">
          The café refunded this payment — it should return to your card within a few days.
        </p>
      </div>
    );
  }

  // Dead pay link (30-minute expiry or staff-cleared): no button, just the
  // way back — a new order or the counter.
  if (read.checkout.reason === "expired") {
    return (
      <div className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-raised p-5 text-left">
        <p className="text-sm font-semibold text-ink-900">This payment link has expired.</p>
        <p className="mt-1 text-sm text-ink-600">{read.checkout.copy}</p>
      </div>
    );
  }

  // Counter-only café, unpriced order, tiny total: the resolver's sentence.
  if (read.checkout.mode !== "online") {
    return (
      <div className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-raised p-5 text-left">
        <p className="text-sm text-ink-600">{read.checkout.copy}</p>
      </div>
    );
  }

  // Fresh from Stripe: paid at Stripe, board catching up — polls itself to
  // Paid, then hard-stops to a manual check instead of spinning forever.
  if (returnPay === "success" && read.live?.paid && stored !== "paid") {
    if (exhausted) {
      return (
        <div className="mx-auto mt-5 max-w-md rounded-2xl border border-info-300 bg-info-50 p-5 text-left">
          <p className="text-sm font-semibold text-ink-900">Still confirming…</p>
          <p className="mt-1 text-xs text-ink-600">
            Stripe has your payment; the café&apos;s board is still catching up. Check again, or ask
            staff to check the order.
          </p>
          <button
            type="button"
            onClick={() => void checkAgain()}
            disabled={checkingAgain}
            className="mt-3 rounded-full bg-accent-700 px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {checkingAgain ? "Checking…" : "Check again"}
          </button>
        </div>
      );
    }
    return (
      <div
        className="mx-auto mt-5 max-w-md rounded-2xl border border-info-300 bg-info-50 p-5 text-left"
        aria-busy="true"
      >
        <p className="text-sm font-semibold text-ink-900">Payment received — confirming…</p>
        <p className="mt-1 text-xs text-ink-600">
          Stripe has your payment; the café&apos;s board updates within seconds. This checks itself
          — no need to refresh.
        </p>
      </div>
    );
  }

  const failed = stored === "failed";
  const cancelledNote =
    returnPay === "cancelled" && !failed ? "Payment was cancelled — no money moved. " : "";
  const lead = failed
    ? "That card payment didn't go through — nothing was charged. "
    : cancelledNote ||
      "Pay by card now to send your order to the kitchen — the money goes straight to the café. ";

  return (
    <div className="mx-auto mt-5 max-w-md rounded-2xl border border-line-200 bg-surface-raised p-5 text-left">
      <p className="text-sm text-ink-600">
        {lead}
        {failed || returnPay === "cancelled" ? "Try again, or pay at the counter." : ""}
      </p>
      {startError && (
        <p role="alert" className="mt-2 text-sm text-danger-800">
          {startError}
        </p>
      )}
      <button
        type="button"
        onClick={() => void begin()}
        disabled={starting}
        className="mt-3 rounded-full bg-accent-700 px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
      >
        {starting
          ? "Starting payment…"
          : failed
            ? "Try card again"
            : stored === "pending"
              ? "Continue to payment"
              : "Pay by card"}
      </button>
      <p className="mt-2 text-xs text-ink-500">
        Or pay at the counter — cash, EFTPOS or on collection.
      </p>
    </div>
  );
}

"use client";

/**
 * Forced-state preview of the Settings → Payments copy (no Stripe calls).
 * `?state=` picks one of the seven card states; anything else shows all
 * seven in order so review reads top to bottom.
 */

const STATES = [
  "choose",
  "stripe-details",
  "connecting",
  "pending",
  "active",
  "restricted",
  "venue",
] as const;

type DemoState = (typeof STATES)[number];

function isDemoState(value: string | undefined): value is DemoState {
  return !!value && (STATES as readonly string[]).includes(value);
}

const COPY: Record<DemoState, { title: string; body: string; action: string | null }> = {
  choose: {
    title: "Choose — no provider",
    body: "Diners pay at the counter today. Connect Stripe to also take cards at the table.",
    action: "Set up card payment",
  },
  "stripe-details": {
    title: "Stripe details — what happens next",
    body: "One account per café · Stripe walks through identity on their page · back here only when the account can charge.",
    action: "Continue to Stripe",
  },
  connecting: { title: "Connecting", body: "Opening Stripe… (no fake percentages).", action: null },
  pending: {
    title: "Pending — waiting on Stripe",
    body: "Finish the setup on their page. Diners still pay at the counter until then.",
    action: "Finish setup · Check again",
  },
  active: {
    title: "Active — cards on",
    body: "Diners can pay by card; payouts land in the café's Stripe account; refunds happen in the Stripe dashboard.",
    action: "Use pay at the counter · Turn off",
  },
  restricted: {
    title: "Restricted — action needed",
    body: "Stripe paused card payment. No money is stuck; diners pay at the counter until it's fixed.",
    action: "Fix in Stripe · Check again",
  },
  venue: {
    title: "Venue — a finished state",
    body: "Pay at the counter is on. What diners see now: pay at the counter.",
    action: "Turn card payment on",
  },
};

export function PaymentsDevDemo({ forcedState }: { forcedState?: string }) {
  const only = isDemoState(forcedState) ? forcedState : null;
  const shown = only ? [only] : [...STATES];
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-500">
        Dev harness — /dev/payments
      </p>
      <h1 className="mt-1 text-xl font-bold text-ink-900">Payments card states</h1>
      <p className="mt-1 text-xs leading-5 text-ink-500">
        The money goes to the café&rsquo;s Stripe account; Eateryo never holds it. Query{" "}
        <code>?state=pending</code> (or choose, stripe-details, connecting, active, restricted,
        venue) to pin one state.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        {shown.map((state) => (
          <div key={state} className="rounded-2xl border border-line-200 bg-surface-base p-5">
            <h2 className="text-sm font-bold text-ink-900">{COPY[state].title}</h2>
            <p className="mt-1 text-xs leading-5 text-ink-500">{COPY[state].body}</p>
            {COPY[state].action && (
              <p className="mt-3 text-xs font-semibold text-ink-900">{COPY[state].action}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

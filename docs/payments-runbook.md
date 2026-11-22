# Café card payments — operator runbook

Direct charges on the café's own Stripe account (`Stripe-Account: acct_…`,
0% fee). Eateryo never holds funds, so every money question is answered on
the **connected account**, never the platform. Sandbox first: nothing below
touches a live key until the preview matrix is green.

## Read a stuck payment

1. Read the order row: `status`, `payment_status`, `payment_provider`,
   `payment_reference` (the `cs_…`), `total_cents`, `updated_at`.
   - `new` + `unpaid`/`pending`/`failed` + `payment_provider = 'stripe'`:
     the ticket is hidden from the kitchen board (Option A) and sits in the
     awaiting-payment pill.
   - `cancelled` + `unpaid`: the pay link died — the board poll swept a
     sessionless ticket past 30 minutes, `checkout.session.expired` fired
     for a ticket that named a session, or staff Cleared it. The row is
     the audit copy — nothing is deleted.
   - The board sweep is DB-only and never touches Stripe: it cancels only
     stale tickets that never minted a session (nothing could have been
     paid). A ticket naming a session is never cancelled by the poll — a
     missed webhook or an outage must not kill a possibly-paid order.
     Paid-then-missed is reconciled by `payment-check` (staff pill or the
     board's once-per-snapshot auto-check).
2. Look the session up on the **café's account**, not the platform:
   retrieve `cs_…` with the `Stripe-Account: acct_…` header and check
   `metadata.orderId` matches the order id. A session without our order id
   is not ours.
3. "Check payment" on the pill re-reads Stripe directly and covers the
   missed-webhook case (listener was down). If the session is paid and the
   row is not, take the id from step 2 and watch the next webhook delivery;
   if the row paid meanwhile, the replay guard (`stripe_event`) makes the
   duplicate a no-op.
4. Transport failures surface as 503 with `reportError` events
   (`payments.session_reuse_failed`, `payments.checkout_create_failed`,
   `payments.checkout_failed`) carrying the `requestId` — the diner is told
   to pay at the counter, and nothing is double-charged: one open session is
   reused per order.

## Replay a webhook

- The handler verifies the raw body HMAC, pairs `event.account` with the
  order's restaurant (a foreign account is 200-ignored and logged, never
  applied), and records `stripe_event` so a duplicate delivery changes
  nothing twice.
- `stripe trigger` is transport only: it carries no useful
  `event.account`, so it cannot prove the tenancy pairing. Replay a real
  captured body with a valid signature instead (Stripe CLI `events resend`
  replays the platform copy of a real event).
- After a replay, the order must show exactly one paid transition and one
  kitchen ticket.

## Rotate the webhook secret

- Local: restart `stripe listen --forward-connect-to
http://localhost:3100/api/stripe/webhook …`; each restart mints a new
  `whsec_…`. Copy it into the worktree `.env.local` as
  `STRIPE_WEBHOOK_SECRET` and restart the dev server. A stale secret answers
  400 with a redacted log line.
- A 401 `api_key_expired` from `stripe listen` is the CLI login/device key,
  not the app key: `stripe logout`, `stripe login`, fresh `wh_…`/`whsec_…`.

## Restrict an account in an emergency

Pause or restrict the café's connected account in the Stripe dashboard.
The resolver fail-closes: every pay button hides, diners get pay-at-counter
copy, and paid history still reads paid. The board keeps working — a payment
problem never blocks the kitchen. Un-restrict and press "Check again" to
bring cards back.

## Refunds

Refunds happen in the café's Stripe dashboard, by the café, on the day if
possible (the live pilot refunds the test payment the same day). The board
follows `charge.refunded` onto the chip. There is no in-app refund in v1 —
tell the diner the café issues it from Stripe.

## What to tell a diner

- Declined: the order stays open — retry the card or pay at the counter.
- Challenge cancelled: the order stays unpaid — retry from the receipt.
- Link expired (30 minutes, or cleared by staff): place a new order or pay
  at the counter. The receipt explains this with no pay button.
- Too many tries: "wait a minute and try again" (12 attempts per
  minute per connection, `Retry-After: 60`).
- Never promise "instant" or "no fees": the money goes to the café's Stripe
  account; Eateryo never holds it.

## Testing the sweep without waiting

`EATERYO_AWAITING_TTL_MS=120000` (and
`EATERYO_AWAITING_CLEAR_AFTER_MS=30000` for the staff Clear) in the worktree
`.env.local`, then restart the dev server. Dev/test only — production
ignores both variables, so a stray value can never kill live tickets early.

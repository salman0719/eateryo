# AGENTS.md — Instructions for coding agents

This file is the single source of truth for automated contributors.
Read it before making any change.

## Local, per-machine notes

If `local/MEMORY.md` exists in this checkout, read it before starting work and
follow it. It holds per-machine preferences — commit wording, tool habits,
workflow notes — and lives in the gitignored `local/` sandbox, so **its absence
is normal, not an error**. It may add personal preference on top of this file;
it never relaxes the security, scope, or tenancy rules below.

## Project

Eateryo — see `PLAN.md` for mission, stack, and the Phase 1
acceptance criteria, and `PHASE-2.md` (scope) + `ROADMAP.md` (build order)
for the current phase.

Product name: **Eateryo** (renamed from Tablepass, decided 2026-10-22). "AI Menu
Digitizer" was the Phase 1 name — keep it only where historical context
demands it; all user-facing copy uses Eateryo.

Phase 1 (the local-first P0/P1 prototype) is complete and deployed.
Phase 2 — accounts, a server DB, cross-device table ordering, one-click
publishing for table ordering, and a usage-billed B2B extraction API — is scoped
in `PHASE-2.md`. Work follows `ROADMAP.md` step by step: auth, billing, a
remote DB, and public publishing are allowed **only when a roadmap step
schedules them**, and nothing outside `PHASE-2.md`'s scope.

## Critical commit rules

- Keep commits small, focused, and easy to review.
- Do not commit secrets. Never commit `.env.local` or any real API key.

## Workflow

- Inspect the repo before overwriting working code.
- Keep one canonical menu schema (`src/features/menu/schema.ts`). Do not invent
  competing types. Agents B/C/D consume Agent A's schema.
- Prefer editing existing files over creating new ones.
- Match existing conventions (App Router, TypeScript strict, Tailwind).
- Do NOT add shadcn/ui (user decision). Use Tailwind + small local primitives.
- Do not add dependencies unless they materially reduce effort or improve reliability.

## Local workspace (`local/`)

`local/` is the research and experiment sandbox. `local/README.md` is the only
tracked file there; read it before starting research, a spike, a prototype, or
a one-off investigation.

- Look for an existing topic folder first and reuse the one whose purpose fits.
- Create a kebab-case folder only when none fits, and add it to the README's
  folder index in the same change.
- Keep the root of `local/` for the README and genuinely cross-topic files;
  put one-off scripts and outputs in a topic folder.
- Deliverables are HTML, not Markdown-only. Markdown is for source notes and
  folder READMEs.
- A serious finding may live there, but anything that changes a product or
  roadmap decision must also be promoted into tracked repo docs or the issue
  log. Nothing under `local/` except its README is committed.

## Quality gates (run before finishing)

- `npm run lint`
- `npm run format:check` (Prettier, no writes; fix with `npm run format`)
- `npm run theme:check` (cheap: fails if the generated icon or token module is
  stale; regenerate with `npm run theme:tokens` when `theme.css` changes)
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run secrets:check` (after the build: fails if a server secret reached
  the client bundle; prints env names, never values)

If a gate fails, fix the cause. Do not skip tests, weaken assertions, swallow
errors, or add lint/type suppressions just to make checks pass.

## Stack rules

- Next.js App Router + TypeScript strict + Tailwind CSS.
- Colour usage: components name the role tokens in `src/app/theme.css` —
  `ink` (text), `surface` (backgrounds), `line` (borders, dividers, rings),
  `accent` (brand actions, focus rings, links), `warning` (caution and
  draft/paused/review states, never a primary action), `danger`, `success`, `info`,
  `on-accent` (text on a filled control), `scrim` (the overlay behind a sheet).
  Never add raw palette utilities (`text-stone-<shade>`,
  `bg-white`, `border-amber-<shade>`) in new or edited code; name a role token
  instead. A colour that genuinely
  cannot belong to a role is allowed on the bespoke component alone, with a
  comment saying why no category applies. Token values change in `theme.css`
  only — never inline in a component.
- Zod for AI output, stored records, and imported files.
- Image extraction vendors (Gemini, Groq) only via the server-side route
  (`src/app/api/extract-menu/route.ts`). Keys live in `GEMINI_API_KEY` /
  `GROQ_API_KEY` (server only). Never use `NEXT_PUBLIC_` for secrets, never
  ship a key in client bundles or logs.
- Native IndexedDB for menus + image blobs. localStorage only for tiny prefs.
- Vitest for unit tests.
- Phase 2 rules (when a roadmap step schedules them): server DB and auth per
  `PHASE-2.md` §3.3; Zod-validate every server boundary; never trust
  client-supplied totals or ownership ids; API keys hashed, shown once,
  revocable; usage recorded in our own ledger; secrets server-side only.
  Migrations are generated offline (`npm run db:generate`) and applied only
  explicitly (`npm run db:migrate`) — never at request time; `drizzle/` is
  generated output, never hand-edited. Sign-in is Better Auth magic link
  only (`PHASE-2.md` §3.6); server files never ship to client bundles.

## AI extraction honesty

- Never invent prices, descriptions, dietary labels, or ingredients. Use `null`/empty.
- Uncertainty goes in `reviewNotes`. Demo/mock data must be clearly labelled as demo.
- Server must not leak provider errors, credentials, or stack traces to the browser.

## File map

- `src/features/menu/schema.ts` — canonical Zod schema + types (Agent A owns)
- `src/features/menu/menu-utils.ts`, `types.ts` — IDs, ordering, edit helpers
- `src/lib/ai/` — provider wrapper, prompt (Agent C owns, server-only)
- `src/app/api/extract-menu/` — API route (Agent C owns)
- `src/components/menu-editor/`, `src/features/menu/indexeddb.ts`,
  `storage.ts`, `import-export.ts` — editor + persistence (Agent D owns)
- `src/components/tables/restaurant-tables.tsx` — the signed-in Tables tab:
  restaurant picker for owners and staff; one QR per table, scoped to the
  restaurant (`/r/<slug>/t/<label>`), never to one menu. `table-qr-panel.tsx`
  serves only the Tables tab — the menu editor's Table QR mode is removed.
- `src/components/upload/`, layout — shell + upload (Agent B owns)
- `src/components/layout/app-sidebar.tsx`, `sidebar-preference.ts` — the app's
  left column: destinations from `availableSections` (signed-out gating included),
  the open menu's outline in the edit workspace, the account, and a
  rail/expanded toggle whose choice is remembered. Widths are CSS driven by
  `data-sidebar` on `<html>`, set before paint by the boot script in
  `layout.tsx` so a saved choice never flashes. The app shell has no desktop
  header; `site-header.tsx` stays for content pages (launch, legal, dev).
  The column belongs to the account: `shellColumnVisible` (`navigation/routes.ts`)
  never shows it signed out, because a column holding "Capture" (and, with a
  draft, "My menus") reads as a broken menu, not as a front door. It stays off
  while the session or the library is still answering — an unanswered read is
  neither signed in nor signed out, so the shell holds a neutral placeholder
  instead of guessing. A signed-out draft is reached through the brand row's
  My menus button and the phone tab bar instead. The brand wrapper inside it must stay a
  flex container — the rail centres it with `justify-content` alone, so a
  block wrapper puts the tile at the padding edge while the icons below stay
  centred (`tests/sidebar-brand.test.ts` holds that).
- `src/components/ui/brand.tsx`, `src/components/layout/brand-bar.tsx` — the
  one brand lockup (tile + name, role tokens only) and the row that carries it
  wherever the column is absent: below `sm` always, and at every width for a
  visitor. Signed out it is the only sign-in path there is — the sidebar never
  shows without an account and the More sheet is signed-in only — so it
  carries `/sign-in` itself plus a My menus button while this browser holds a
  draft, and it shows nothing extra while the session is
  unanswered. The chosen identity (concept 7, "The Hidden Eat") is not applied
  yet: the theme landed first, then the drawn lockup replaces the text in
  `brand.tsx` only.
- `src/components/pages/capture-page.tsx` — the capture screen, and therefore
  the front door. Signed out with an empty page it renders the entry
  composition (one promise, the photo field, three claims the app actually
  keeps; two columns from `lg`, one on a phone so the field is never below the
  fold). The moment a photo exists — or the visitor is known to be signed in —
  it returns to the plain working layout, and an owner never sees the entry.
- `src/app/theme.css` — design tokens: palette ramps (legacy, being migrated)
  plus the role ramps components use; the Theme Studio edits this file. Colour
  and font decisions belong here, never inline in a component.
- `scripts/build-theme-tokens.mjs`, `src/lib/theme/tokens.ts` — the two
  surfaces that cannot read a CSS variable, the app icon and the HTML emails,
  take their colours from the theme: the script resolves `theme.css` into
  `src/lib/theme/theme-tokens.ts` and `src/app/icon.svg`. Both are committed
  files, written only when the script is run: a colour change runs
  `npm run theme:tokens` deliberately and commits the two with the theme.
  `npm run theme:check` (in the gate list) fails when they are stale. Never
  hand-edit them; `tests/theme-tokens.test.ts` catches that, and fails if a hex
  literal returns to `src/lib/email-layout.ts`.
- `src/features/onboarding/journey.ts`, `src/components/ui/journey-steps.tsx` —
  the one four-stop onboarding tracker (Upload · Extract · Review · Publish)
  shared by capture and the publish wizard. Signing in is a gate inside
  Publish, never a stop, so the tracker's length is fixed for everyone; the
  wizard continues it only when the flow came through review
  (`rememberPublishJourney`), so a plain library deep link gets a heading
  instead of a tracker with a false "3 done".
- `src/components/ui/icons.tsx` — the hand-drawn icon set (no icon
  dependency): stroked 24-grid glyphs that inherit `currentColor` and are
  `aria-hidden`, so the control around them carries the label. Starts with
  `ChevronUpIcon`/`ChevronDownIcon` for the editor's disclosures.
- `src/components/ui/collapse.tsx` — the disclosure animation: a one-row CSS
  grid whose track goes 0fr ↔ 1fr, so both directions animate, a mid-flight
  toggle retargets instead of jumping, and nothing is measured; content stays
  mounted and `inert` while shut, and reduced motion snaps. The wrapper must
  stay layout-neutral — padding and borders belong on the content inside.
- `src/lib/motion/height-reveal.ts`, `src/components/ui/height-reveal.tsx` —
  reusable height-reveal animation: measures the rendered content and
  animates the wrapper 0 → that height with WAAPI, retargets mid-flight, then
  releases to `height: auto`; `observeResize` is the opt-in for animating later
  content/reflow height changes and reduced motion shows content instantly.
  Dev showcase at `/dev/height-reveal`; tests in `tests/height-reveal.test.ts`
- `tests/` — schema, utils, import-export, route tests
- `src/lib/db/`, `drizzle/` — Drizzle schema + lazy Neon client; generated
  migrations (do not hand-edit `drizzle/`)
- `src/lib/auth/`, `src/lib/auth-client.ts`, `src/app/api/auth/`,
  `src/app/sign-in/` — Better Auth magic-link config, email sender, route,
  session guard, sign-in page
- `src/lib/auth/dev-sign-in.ts`, `src/app/api/dev/magic-link/` — the
  `DEV_SIGN_IN_BYPASS=1` local shortcut: the auth instance parks the freshly
  minted link instead of emailing it and the sign-in page offers it as an
  explicit button, so the browser still walks the real verification route.
  Every surface that offers a magic link reads the parked link back through
  `src/components/auth/dev-sign-in-link.tsx` (`useDevSignInLink` +
  `DevSignInPanel`); a surface that only calls `signIn.magicLink` claims an
  email was sent while the link sits unread in the store — the invitation
  page did exactly that until 2026-11-09.
  Off in production whatever the variable says (the flag check returns false
  for `NODE_ENV=production`), never a direct session insert, one read per
  link for the address that asked, five-minute window. The store sits on
  `globalThis` because each route entrypoint is its own module instance: a
  module-level one is empty in the route that reads it, which made every dev
  sign-in report an expired link. Tests: `tests/dev-sign-in.test.ts`
- `src/features/session/state.ts` — the pure tri-state session read
  (`signed-in` / `signed-out` / `unknown`) and the device-stamp menu access
  matrix; a page load whose session has not answered is **never** treated as
  signed out, so a reload of `/menus/<id>` cannot accuse its owner
- `src/features/tenancy/repo.ts`, `src/app/api/restaurants/` —
  ownership-scoped restaurant repository + API (session id only);
  `src/features/tenancy/client.ts` — typed browser client for it
- `src/features/tenancy/workspace.ts`,
  `src/components/layout/workspace-switcher.tsx` — the one membership the
  shell acts in. One sign-in can hold an owner café and a staff café, so the
  shell asks only the active membership's capabilities (never a union), and
  Settings/Tables follow the same café instead of keeping a second picker;
  the choice is a per-account device preference. Tests:
  `tests/tenancy-workspace.test.ts`.
- `src/features/tenancy/invitations.ts`, `invite-mailer.ts`,
  `src/app/api/invitations/`, `src/app/invitations/[token]/` — one-time
  email invitations: hash-only tokens, email-match accept, 7-day expiry,
  and the owner's pending list with resend/revoke
- `src/features/tenancy/audit.ts`, `audit-format.ts`,
  `src/app/api/restaurants/[restaurantId]/audit/` — team audit trail:
  snapshot actor/target names, member-scoped reads (404 across tenants),
  best-effort writes; UI in `src/components/settings/team-activity.tsx`
- `src/components/order/order-cart.tsx` + `order-sheet.tsx` — one cart, two
  homes, chosen by `useWideLayout` at Tailwind's `lg`: a one-column phone gets
  the bottom sheet that "View order" raises (`order-sheet.tsx`, pinned to the
  frame in a `PhoneFrame`, viewport-fixed with the page scroll locked on a real
  diner page), and a wide page gets the sticky right-hand column
  (`OrderCartPanel`) beside the menu. `OrderCartLines` is the only line/note
  markup, so the two cannot drift. Only one is mounted at a time, which is why
  the kitchen note id stays unique. The owner preview is always phone-shaped
  inside its frame, so it always uses the sheet, never the column.
- `src/features/menus/` — Step 8 server menus: `repo.ts` (tenancy-scoped,
  conditional-UPDATE `updatedAt` conflict detection), `sync.ts` (typed
  browser client with `SyncError` codes), `move-to-account.ts` (one-way
  local import, one menu or the whole library); routes in
  `src/app/api/menus/`; editor UI in
  `src/components/menu-editor/conflict-banner.tsx` + `move-to-account-panel.tsx`
- `tests/helpers/pg-test-db.ts`, `tests/tenancy.test.ts`,
  `tests/auth-magic-link.test.ts` — Step 7 isolation/auth tests (PGlite);
  `tests/menus-repo.test.ts`, `tests/menus-api.test.ts`,
  `tests/menus-sync.test.ts`, `tests/move-to-account.test.ts` — Step 8
  (PGlite + stubbed fetch; conflict, tenancy, import fidelity)
- `src/features/menus/membership.ts` — the one tri-state answer to "where is
  this menu saved?" (`account` / `browser` / `unknown` / `unreachable`), so the
  editor and the publish panel never claim "this browser only" before the
  account's menu list has been read (001, 003); `membershipFlag` maps it to the
  `boolean | null` the components take. While it is `unknown` the membership
  surfaces (save status, publish hint, Table ordering card, storage footnote)
  render placeholders with the wait announced only to screen readers, so no
  sentence is printed and then retracted. `unreachable` is the read that
  settled by _failing_: those surfaces say the account couldn't be checked and
  offer **Try again**, the save status never claims browser-only, and the
  café-creating flow stays off because it would mint tenancy on a guess (016).
  Tests: `tests/menu-membership.test.ts`, `tests/editor-membership.test.ts`.
- `src/features/item-images/` — dish photos on menu items: `sizes.ts` (the
  pre-sized copies: display ≤1024px, thumb ≤256px), `prepare.ts` (browser
  decode/resize/encode, so the camera original is never uploaded), `ref.ts`
  (build/read the stored reference), `upload.ts` (UploadThing browser client),
  `src/app/api/uploadthing/` (session-gated file router, `UPLOADTHING_TOKEN`
  server-side only; 503 until it is set). Photos are part of the menu document
  like any other field, so publishing snapshots them. Rendered with a plain
  `<img>` straight from the CDN — never `next/image`, so Vercel's image
  optimizer never touches a dish photo. Stored files are never deleted on
  replace/remove: a published revision may still be serving the old one.
  Tests: `tests/item-images.test.ts`, `tests/item-image-prepare.test.ts`.
- `scripts/cleanup-dish-photos.mjs`, `scripts/lib/dish-photo-sweep.mjs` — the
  maintenance sweep that reclaims abandoned dish photos: it deletes only
  `dish-…` files that no `menu`/`menu_revision` document references and that
  are older than the retention window (30 days), and lists every file it keeps
  with the reason. Dry run by default; `--delete --yes` acts, and it refuses a
  database with no menus. `npm run photos:sweep`; tests in
  `tests/dish-photo-sweep.test.ts`. Nothing schedules it.
- `src/features/publishing/` — Step 9 publish: `schema.ts` (slug rules +
  publication status), `slug.ts` (deterministic slug generation and collision
  candidates), `repo.ts` (snapshot revisions, publish/unpublish, the diner
  read path ordering uses, plus `getLiveMenuDoc` for the owner's "what
  changed" comparison), `client.ts` (typed browser client), `changes.ts` (the
  pure live-vs-draft diff behind the publish panel's "Since you last
  published" counts and list — matched by id, never by name). Publishing
  means "make this menu orderable at the tables": it snapshots the menu and
  marks it live. There is no public menu page, no menu URL, no menu QR code
  and no view count — a menu is reached only through a table card at
  `/r/<restaurant>/t/<table>`, and its own order address is
  `/r/<restaurant>/m/<menu>/order?table=<label>`. Menu slugs are unique per
  restaurant (`published_menu_restaurant_slug_unique`), never globally, so
  two cafés may both hold `lunch`. Onboarding names the first menu itself
  (`resolveFirstMenuTitle`: "Main Menu", or the service the photo clearly
  names) and never asks for a name or link; the photo's own title is kept in
  `source.originalTitle` for the café-name suggestion only. Routes:
  `src/app/api/menus/[menuId]/publication/` (and its `/live` read, the
  snapshot diners see now). Editor UI
  `src/components/menu-editor/publish-panel.tsx`; the owner-facing preview is
  a read-only rendering of the diner order page
  (`src/components/order/order-page-preview.tsx`, ordering off), shared by
  the editor, publish wizard and onboarding result. Tests:
  `tests/publishing-slug.test.ts`, `tests/publishing-repo.test.ts`,
  `tests/publishing-api.test.ts`, `tests/menu-changes.test.ts`. Invariant: table ordering renders
  `menu_revision`, never `menu.doc`, so edits stay private until "Publish
  changes".
- `src/features/orders/` — Step 10 table orders: `schema.ts` (canonical
  order schema, the status transitions, totals), `repo.ts` (server-only:
  snapshot-priced placement, membership-scoped board + cursor, conditional
  status writes, fixed-window rate limit), `client.ts` (typed browser client),
  `storage.ts` + `table-links.ts` (Phase 1 local queue + link helpers).
  Routes: `src/app/api/orders/` (public POST, staff GET) and
  `src/app/api/orders/[orderId]/` (PATCH). Diner page
  `src/app/r/[restaurantSlug]/m/[menuSlug]/order/page.tsx` (snapshot only,
  noindex) with
  `src/components/order/` (`order-menu.tsx` shared UI, `order-sheet.tsx` the
  shared cart sheet, `server-table-order.tsx`, `table-order.tsx` for local
  mode, `table-order-tabs.tsx` for the multi-menu landing and
  `table-landing.tsx` the landing screen that owns it). The confirmation every
  flow ends on is its own module, `order-received.tsx`: it is a different
  screen from the ordering page (nothing may say "2 menus are open" after the
  order is in), it never borrows that page's chrome, and it is where the
  receipt (status, timing) will grow. Flows hand it an `Order` and their own
  footnote; they never render the receipt's markup. Staff board
  `src/components/orders/server-orders-board.tsx` (5 s polling with backoff
  and a visible reconnect state) behind the session switch in
  `orders-board.tsx`. Tests: `tests/orders-repo.test.ts`,
  `tests/orders-api.test.ts` (PGlite + real handlers).
  Invariants: a diner sends ids/variants/quantities only — names, prices, and
  totals are resolved server-side from the published snapshot and the total
  is null when any line is unpriced; statuses only move forward.
- `tests/invitations.test.ts`, `tests/invitations-api.test.ts`,
  `tests/audit.test.ts`, `tests/audit-api.test.ts` — invitation and team
  audit coverage (PGlite; the emailed token is captured and reused).
- `src/lib/observability/` — Step 11 structured logs (`log.ts`: JSON lines,
  request ids, credential redaction, no stacks) and operator alerts
  (`alerts.ts`: Resend email to `OPS_ALERT_EMAIL`, deduped per process)
- `src/proxy.ts` — Next 16 proxy that mints/echoes `x-request-id`; not an
  authorization layer
- `src/lib/http/origin.ts` — same-origin guard (`rejectCrossOrigin`) used by
  every state-changing route; `next.config.ts` carries the security headers
- `src/features/usage/` — Step 11 extraction ledger + cost brake: `schema.ts`
  (cap, month window), `pricing.ts` (cost only from configured rates),
  `repo.ts` (record/summarize/count), `client.ts`; `src/app/api/usage/`
- `src/features/launch/` — onboarding snapshot (`repo.ts`), pure checklist
  derivation (`steps.ts`), schemas + client; `/api/launch`, page `/launch`,
  UI in `src/components/launch/` (checklist, plus the account export card and
  the account danger zone, both rendered by Settings)
- `src/features/retention/` — Step 11 retention: `schema.ts` (window config),
  `repo.ts` (`purgeOldOrders`, `buildAccountExport`, `deleteAccountForUser`,
  `isCronAuthorized`), `client.ts`; routes `/api/account` (DELETE),
  `/api/account/export`, and `/api/cron/retention` (secret-gated maintenance
  purge — **automatic scheduling is parked**: no `vercel.json` cron, nothing
  calls it daily, and no copy promises automatic deletion)
- `src/app/privacy/`, `src/app/terms/`, `src/lib/site.ts` — legal pages and
  shared site constants (`CONTACT_EMAIL` lookup)
- `scripts/check-client-secrets.mjs` — client-bundle secret scan
- `docs/` — launch runbook, two-device test script, backup/restore drill
- `PHASE-2.md` — Phase 2 scope, service choices, acceptance criteria
- `ROADMAP.md` — current build order (Phase 1 steps done, Phase 2 steps planned)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

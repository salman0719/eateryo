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
- `src/components/menu-editor/category-strip.tsx`, `dish-row.tsx`,
  `item-inspector.tsx`, `src/features/menu/editor-selection.ts` — the
  Categories tab's shape: one strip (category tabs · menu-wide search ·
  - Category), one category on the canvas, and the selected dish in a sticky
    340px inspector (one column below `lg`, where a selected dish replaces the
    list). Selection is per-menu device state, resolved against the live
    document every render, and replaces the old fold model (`fold.ts`, retired):
    nothing in this tab collapses, so a dish's form never unfolds under a row.
- `src/components/tables/restaurant-tables.tsx` — the signed-in Tables tab:
  restaurant picker for owners and staff; one QR per table, scoped to the
  restaurant (`/r/<slug>/t/<label>`), never to one menu. `table-qr-panel.tsx`
  serves only the Tables tab — the menu editor's Table QR mode is removed.
- `src/components/upload/`, layout — shell + upload (Agent B owns)
- `src/components/layout/app-sidebar.tsx`, `sidebar-preference.ts` — the app's
  left column: destinations from `availableSections` (signed-out gating included),
  the account, and a rail/expanded toggle whose choice is remembered. It
  carries no menu outline: the editor's tab strip and category pills own
  switching (step 12 retired the "In this menu" list). Widths are CSS driven by
  `data-sidebar` on `<html>`, set before paint by the boot script in
  `layout.tsx` so a saved choice never flashes. The app shell has no desktop
  header; `site-header.tsx` stays for content pages (launch, legal, dev).
  The column belongs to the account: `shellColumnVisible` (`navigation/routes.ts`)
  never shows it signed out, because a column holding "Capture" reads as a
  broken menu, not as a front door. It stays off while the session or the
  library is still answering — an unanswered read is neither signed in nor
  signed out, so the shell holds a neutral placeholder instead of guessing. A
  returning account never watches that placeholder turn into a column: the
  boot script's `data-session` attribute puts the session loader
  (`session-loader.tsx`) over the frame until the session, the café and the
  library answer, so the signed-in shape is painted once, complete.
  Signed out there is no navigation at all (`availableSections` is Capture
  only): no My menus, no phone tab bar, no More sheet, and a URL for an
  account surface returns to Capture — `/menus`, `/menus/<id>` and the item
  pages included. The one exception is `/menus/<id>/publish`, the onboarding
  publish step, because the emailed magic link returns there. A leftover
  signed-out draft is resumed from the signed-out capture banner instead,
  which reopens it in the capture result screen (newest first when several
  linger); signed in there is no resume banner. The browser is server-only
  at rest: sign-out dissolves account copies proved in sync
  (`collectSignOutDissolveIds`, hash-matched stamps only — an interrupted
  edit is never dissolved), and the pre-sign-in choice names only
  anonymous drafts (`unstampedIds`), so re-sign-in never asks about a menu
  that is already on an account. The
  brand wrapper inside it must stay a
  flex container — the rail centres it with `justify-content` alone, so a
  block wrapper puts the tile at the padding edge while the icons below stay
  centred (`tests/sidebar-brand.test.ts` holds that).
- `src/app/(app)/layout.tsx` — the one page shell: it mounts the units that
  outlive a screen in dependency order (session and café → route → library)
  inside a Suspense whose fallback is the shell's own geometry. The route is
  read from the URL (`usePathname`, seeded into `NavigationProvider`), so an
  address is never a prop: every route file under `(app)/` is `<AppShell />`
  and nothing else. `/`, `/menus`, `/orders`, `/assistant`, `/tables` and
  `/settings` prerender the shell; `/menus/<id>` (plus `reorder`, `preview`,
  `publish`, `items/<item>`) streams it, because a menu id is not known at
  build time. The catch-all is retired — one narrow
  `/menus/<id>/[...rest]` remains so a stale bookmark, or a table QR link from
  before QR cards moved to Tables, still lands in the library with a message
  instead of a 404. A new screen is one route file plus its `AppScreen`; no
  route file parses a route. The screen itself still renders from one switch in
  the shell — the navigation entry below says why that is deliberate.
- `src/components/layout/app-shell.tsx` — the app's shell, and what every
  `(app)/` route file renders: it owns the units whose life is a screen rather
  than a session (the open document, capture, publication, the row verbs, the
  draft claims) and makes the screen decision, guards included — a signed-out
  account URL goes back to Capture, a membership is sent to a surface it may
  use, a dead publish link gets its card. It renders no chrome of its own; the
  frame it wraps is `ShellFrame`. It also mounts the full-screen session loader
  over that frame while a returning account's reads settle
  (`sessionLoaderCovers`), so the signed-in shell is never watched assembling
  itself.
- `src/components/layout/shell-frame.tsx` — the frame every app screen sits in:
  the left column, the brand row that stands in where the column is absent,
  the workspace switcher, the content measure and footer, the phone tab bar,
  the More sheet and the order monitor's toasts. It renders chrome only —
  sections, counts, notices and the page itself arrive already resolved, the
  page through `children` — so a screen can change without touching the frame.
  `AppShell` owns the shell's state and hands this component the answers; the
  frame is covered by `tests/shell-frame.test.ts`. It also renders the optional
  `sessionLoader` node it is handed, outside the frame and after it in the DOM;
  the frame never decides when that shows. While the loader actually covers the
  shell the frame is `inert` — no tab stop, nothing read out from behind the
  wait — and the signal is the session hint, the same bit the loader's CSS gets
  from the boot script: a visitor's frame is mounted under a hidden element and
  must stay reachable.
- `src/features/navigation/navigation-context.tsx`, `history.ts` — the one
  owner of "which screen is showing": `NavigationProvider` holds the route,
  writes the URL through the pure `historyWriteFor` decision (push, replace,
  or nothing when the href already matches), follows changes the app did not
  make (back/forward, a typed URL, a `<Link>` push), flushes the open editor's
  pending save before leaving a menu, and holds the dead-publish-link state.
  Screens call `navigate(route)`; none takes a parsed route as a prop, and the
  first screen is the one `usePathname()` names (rendered into the HTML, so a
  hard load paints the right screen rather than flashing capture). Moving to
  the App Router's own URLs later changes this provider, not its callers.

  **Why the screens still render from one switch.** Every page file is per
  route, but the child each returns is the shell, which picks the screen from
  `route.screen`. Two decisions put it there, and changing either moves
  behaviour. First, `navigate` writes the URL with `history.pushState` rather
  than pushing a Next `<Link>`: Next does not re-render a page on pushState, so
  the page tree is built once per load and the visible screen has to be
  something that re-renders on route state — the shell is that component. A
  Next push was avoided because it remounts the page component, which is where
  the open menu's document, its pending autosave, the conflict banner and the
  capture review live. Second, the screen is not a function of the URL alone:
  the guards turn an account URL back to Capture when signed out (the publish
  step excepted, for the magic link), send a membership to its first surface
  when the URL names one it cannot use, and hold the dead-publish-link
  recovery; `item`, `reorder`, `preview` and `publish` are modes of the editor
  rather than screens of their own, and an editor URL whose document has not
  arrived yet is its skeleton.
  Rendering per route instead would want the document and capture state hoisted
  above the pages (a menu left open while the reader sits in Settings, with the
  sign-out and café-switch rules that follow), `navigate` on `router.push`, and
  a new home for the guards — server redirects, so a round trip per guarded
  URL. It would buy per-route code splitting, prefetch, and route-level
  `loading`/`error` files, and retire the `AppScreen` union. That is a
  behaviour change, not a move: its own branch, and a browser pass.

  Tests: `tests/navigation-history.test.ts`.

- `src/features/menus/library-context.tsx` — the library and the account's
  answers about it: the browser's menu list, the ids the server proved, the
  café each row belongs to, the per-menu access map and the device's draft
  stamps, behind `useLibrary()`. The markers are tri-state and settle together
  — an empty id set before `serverMenusReadFor` lands means "not asked yet",
  never "this browser only" (001), and a read that ended by failing sets
  `serverMenusReadFailedFor` so surfaces can say the account could not be
  checked (016). The café-keyed merge, the retry and the sign-out reset live
  here, so no screen can hold a second opinion about what the account owns.
  `refreshLibrary` and the café map are stable callbacks, so the shell's route
  opener can name them as dependencies without re-running every render.
- `src/features/menus/active-menu.ts` — `useActiveMenu`: the one open menu
  document — its debounced autosave, `flushSave` (what navigation calls before
  leaving a menu), the account revision the next push is based on, the conflict
  banner's state and its two explicit answers, the editor's photo URL, and the
  import/export of a menu file. It is the only writer of a menu document, so no
  screen can save behind another one's back, and `healStampedDrafts` pushes the
  interrupted work of closed menus on a same-account return. It also files a
  menu, because its own autosave is what creates one: `ensureServerTarget`
  picks the café the editor acts in (or provisions the account's first from
  the menu title), `cacheServerDraft` makes a fresh server row this browser's
  draft, and `pruneSignedOutOthers` keeps signed-out use to one menu. A staff
  shift with no café it may write in therefore files nothing, and
  `cannotFileMenus` shapes the import's refusal. Its reads are per document —
  `getOpenDoc`/`getOpenDocId`
  for the units below it, `openBaseline`/`onServerRevision`/`onMenuRenamed` for
  a rename made in the library, `onOpenDoc` to announce a new document so
  publication never has to be imported. `releaseOpenDoc` and `resetActiveMenu`
  are the sign-out pair: the synchronous release that stops pending work before
  the last edits are saved, then the state clear.
- `src/features/menus/menu-lifecycle.ts` — `useMenuLifecycle`: the library's
  verbs on a menu row — open, start, rename (with its account push), delete —
  and the one membership the shell acts in. It works from the library alone, so
  a rename or a delete can name a menu the editor does not hold, and the open
  document arrives as doors (`openDoc`, `forgetOpenDoc`, `onMenuRenamed`,
  `openBaseline`, `onServerRevision`) instead of a second copy. Starting a menu
  never gates on a name: the row is created by its first change, so leaving now
  leaves nothing behind. The switcher follows the menu — a deep link into
  another café selects that membership, but only while its document is the open
  one, so a document kept in memory while browsing the library cannot drag the
  context back. Deleting is the row's; resetting publication for it stays in the
  shell, the only place that can see both units. Tests:
  `tests/tenancy-workspace.test.ts` covers the membership rules it obeys.
- `src/features/publishing/use-publication.ts` — `usePublication`: the open
  menu's publication — whether it is live, what diners see now, and the three
  actions that change it. It follows the document the editor holds, flushes the
  pending save before a snapshot, and never shows a status loaded for a different
  menu (`publicationMenuId` guards every read). The editor is reached through
  doors: `getOpenDoc`, `flushSave`, `onServerRevision` (the wizard's agreed
  revision) and `onPublishedMenu` (a published capture draft resets capture).
  `resetPublication()` is the one five-line reset the shell used to repeat.
- `src/features/capture/use-capture.ts` — `useCapture`: the capture document —
  the pages selected, the extraction, the result under review, the draft saved
  as it goes, and the review edits (resolve, price, rename). It stops where the
  menu begins: `documentForSave` hands the screen the document to persist, so
  the menu lifecycle and the editor stay out of it. What it needs from its
  neighbours arrives as doors, not shared state — the confirm dialog before a
  discard, the menu lifecycle that files a new menu (`ensureServerTarget`,
  `cacheServerDraft`, `pruneSignedOutOthers`), the screen's `revealResult`
  scroll, and `reportError`. A resumed draft comes back as a document for the
  banner to navigate with, instead of the hook navigating on its own.
- `src/features/menus/draft-claims.ts` — `useDraftClaims`: what happens to a
  menu that lives only in this browser when an account appears. Sign-in adopts
  every draft in one go (no remembered answers, no offer), so this unit owns
  the claim gate's tri-state, the adopt/disregard decision, the café a draft
  lands in, the stamp that makes it the account's, and the dissolving of the
  browser copy the account just took. The editor's two facts arrive as named
  doors — `getOpenDocId` and `onClaimedOpenDoc` — so neither side mirrors the
  other; an open row is pinned to the agreed revision instead of forking it.
- `src/components/ui/brand.tsx`, `src/components/layout/brand-bar.tsx` — the
  one brand lockup (tile + name, role tokens only) and the row that carries it
  wherever the column is absent: below `sm` always, and at every width for a
  visitor. Signed out it is the only sign-in path there is — the sidebar never
  shows without an account and the More sheet is signed-in only — so it
  carries `/sign-in` itself and nothing else: there are no destinations to
  browse, and it shows nothing at all while the session is
  unanswered. Every in-shell sign-in path (brand row, sidebar account, library
  gate) asks about the browser draft first while signed out with one: attach
  it on login, or wipe it on login — staying is one Escape away (`direct-
sign-in.ts`, consumed once per sign-in; the publish wizard's own magic-link
  flow attaches its journey draft silently instead). The chosen identity (concept 7, "The Hidden Eat") is not applied
  yet: the theme landed first, then the drawn lockup replaces the text in
  `brand.tsx` only.
- `src/components/pages/capture-page.tsx` — the capture screen, and therefore
  the front door. Signed out with an empty page it renders the entry
  composition (one promise, the photo field, three claims the app actually
  keeps; two columns from `lg`, one on a phone so the field is never below the
  fold). The moment a photo exists — or the visitor is known to be signed in —
  it returns to the plain working layout, and an owner never sees the entry.
  Signed out, the review result is the whole journey: the inline price and
  "check this" fixes stay, the "Fine-tune in the editor" second path does not
  (there is no signed-out editor route), and the First look carries the bold
  reassurance that everything stays editable once signed in.
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
  session guard, sign-in page. The auth route also mirrors every session
  cookie change into the readable `eateryo.session-hint` flag
  (`src/lib/auth/session-hint.ts`), which is that flag's only writer.
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
  signed out, so a reload of `/menus/<id>` cannot accuse its owner.
  `sessionAnswerPending` is the display-only exception: with the hint absent
  the shell need not hold its placeholder, while `sessionState` stays the
  server's answer for every guard.
- `src/features/session/session-hint.ts`, `use-session-hint.ts`,
  `src/lib/auth/session-hint.ts` — the readable one-bit session hint: absent
  means no session cookie is in this browser (so a visitor's screen needs no
  wait), present means "maybe, ask". The auth-route mirror is its only
  writer, its lifetime mirrors the session cookie's, and it may only choose
  what a screen shows — guards, ownership and data reads keep using the
  server. `SESSION_BOOT_SCRIPT` reads it inline in `layout.tsx` before the
  first paint and leaves `data-session` on `<html>` for `globals.css`; a hint
  applied in a render arrives after hydration, which is too late to be seen.
  Tests: `tests/session-hint.test.ts`, `tests/session-state.test.ts`.
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
  browser client with `SyncError` codes), `move-to-account.ts` (the one-way
  local import the sign-in claim runs — there is no manual import UI, and no
  "Import from this browser" option anywhere); routes in
  `src/app/api/menus/`; claim decisions in `claim-local-drafts.ts`
  (sign-in auto-imports every browser draft; no remembered answers, no
  offer); editor UI in `src/components/menu-editor/conflict-banner.tsx`
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
  `/r/<restaurant>/t/<table>`; there is no per-menu order address (the
  single-menu order route was retired — the table landing is the only
  diner ordering page). Menu slugs are unique per
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
  `src/app/r/[restaurantSlug]/t/[tableLabel]/page.tsx` (snapshot only,
  noindex) with
  `src/components/order/` (`order-menu.tsx` shared UI, including the
  `CategoryRail` + `useScrollSpyCategory` category rail, `order-sheet.tsx`
  the shared cart sheet, `table-order.tsx` for local
  mode, `table-order-tabs.tsx` for the menu tabs, search, category rail and
  shared cart, and `table-landing.tsx` the landing screen that owns it). The confirmation every
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

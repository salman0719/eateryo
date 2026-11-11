import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { StatusChip } from "@/components/ui/status-chip";

export const metadata: Metadata = {
  title: "Status states — dev",
  robots: { index: false, follow: false },
};

/**
 * Dev-only visual reference for the status roles (danger, warning, success,
 * info) in the shapes they take across the app: alerts, pills, buttons and
 * inline messages. Every specimen copies the class recipe used by the real
 * surface named in its caption, so tuning a role in the Theme Studio shows the
 * same result here as on the pages where it appears.
 *
 * The rule this page tests (rule G): a filled control is `accent` or `danger`,
 * never a status hue, and status is a word plus a 6px dot — a second filled
 * green beside the accent made "Publish for ordering" read as the primary
 * action on a screen whose primary action was "Save changes" (ΔE 0.115, and
 * rotating the accent inside the green family moved it only to 0.117).
 *
 * Static and unauthenticated on purpose: it exists to be looked at, and
 * `notFound()` keeps it out of production.
 */
export default function StatusStatesDevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
          <header className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-accent-700 uppercase">
              Dev only
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink-900">Status states</h1>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              The danger, warning, success and info roles in the places they actually appear. Fills
              belong to accent and danger; success is a dot and a word, never a surface. Captions
              name the recipe, so a role that feels wrong here is wrong in the app too. This page is
              unlinked and returns 404 in production.
            </p>
          </header>

          <section aria-labelledby="alerts" className="mt-10">
            <h2 id="alerts" className="text-lg font-bold tracking-tight text-ink-900">
              Alerts and notices
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              The four banner shapes, at the padding used on error, expiry, success and hint
              surfaces.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <article className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4">
                  <p className="text-sm font-semibold text-danger-900">
                    We couldn&apos;t save this menu
                  </p>
                  <p className="mt-1 text-xs leading-5 text-danger-800">
                    The connection dropped before the change reached your account. Your edits are
                    still in this browser.
                  </p>
                  <span className="mt-3 inline-flex rounded-full bg-danger-700 px-3 py-1.5 text-xs font-semibold text-on-accent">
                    Try again
                  </span>
                </div>
                <Caption>invitation error · danger-50 / 200 / 800 · button danger-700</Caption>
              </article>

              <article className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <div
                  role="alert"
                  className="rounded-xl border border-warning-200 bg-warning-50 p-4"
                >
                  <p className="text-sm font-semibold text-warning-900">
                    This invitation has expired
                  </p>
                  <p className="mt-1 text-xs leading-5 text-warning-900">
                    Ask the restaurant owner to send a new one — this link can no longer be used.
                  </p>
                  <span className="mt-3 inline-flex rounded-full border border-warning-300 bg-surface-base px-3 py-1.5 text-xs font-semibold text-warning-900">
                    Request a new link
                  </span>
                </div>
                <Caption>invitation banner · warning-50 / 200 / 300 / 900</Caption>
              </article>

              <article className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <div
                  role="status"
                  className="rounded-xl border border-line-200 bg-surface-base p-4"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-success-700" />
                    You&apos;re in
                  </p>
                  <p className="mt-1 text-xs leading-5 text-ink-600">
                    You joined Olive &amp; Ember as staff. Table orders will appear on the board.
                  </p>
                  <span className="mt-3 inline-flex rounded-full bg-accent-700 px-3 py-1.5 text-xs font-semibold text-on-accent">
                    Open the order board
                  </span>
                </div>
                <Caption>
                  invitation success · surface-base / line-200 · dot success-700 · button accent-700
                </Caption>
              </article>

              <article className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <div role="status" className="rounded-xl border border-info-200 bg-info-50 p-4">
                  <p className="text-sm font-semibold text-info-900">Demo data</p>
                  <p className="mt-1 text-xs leading-5 text-info-900">
                    This menu was generated for a walkthrough, not extracted from a photo. Replace
                    it before publishing.
                  </p>
                  <span className="mt-3 inline-flex rounded-full border border-info-300 bg-surface-base px-3 py-1.5 text-xs font-semibold text-info-900">
                    Open the editor
                  </span>
                </div>
                <Caption>demo menu notice · info-50 / 200 / 300 / 900</Caption>
              </article>
            </div>
          </section>

          <section aria-labelledby="pills" className="mt-10">
            <h2 id="pills" className="text-lg font-bold tracking-tight text-ink-900">
              Status chips
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              One chip, one dot. The words carry the state; the dot carries the hue, and the surface
              stays neutral so a status can sit beside an accent button without competing with it.
            </p>

            <div className="mt-4 rounded-2xl border border-line-200 bg-surface-base p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip>Not published</StatusChip>
                <StatusChip tone="warning">Ordering paused</StatusChip>
                <StatusChip tone="info">Preparing</StatusChip>
                <StatusChip tone="success">Ordering open</StatusChip>
                <StatusChip tone="danger">Possible duplicate</StatusChip>
                <StatusChip size="sm">Cancelled</StatusChip>
                <StatusChip size="sm" tone="success">
                  On your account
                </StatusChip>
              </div>
              <Caption>
                publish panel · orders board · library row · StatusChip (surface-100 / ink-900 /
                dot)
              </Caption>
            </div>

            <div className="mt-4 rounded-2xl border border-line-200 bg-surface-base p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 py-0.5 pr-1 pl-2.5 text-xs font-medium text-ink-700">
                  Vegetarian
                  <span className="rounded-full px-1 leading-none text-ink-500">✕</span>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-surface-100 px-3 py-1 text-xs font-semibold text-ink-600">
                  New orders
                  <span className="rounded-full bg-danger-600 px-1.5 py-0.5 text-[11px] font-bold text-on-accent">
                    12
                  </span>
                </span>
                <span className="rounded-full bg-surface-200 px-3 py-1 text-xs font-semibold text-ink-600">
                  Sold out
                </span>
              </div>
              <Caption>
                tag chip · count badge (danger-600) · sold-out chip — content and counts are
                neutral, not status
              </Caption>
            </div>
          </section>

          <section aria-labelledby="buttons" className="mt-10">
            <h2 id="buttons" className="text-lg font-bold tracking-tight text-ink-900">
              Buttons
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              Fills are accent and danger only. Success, warning and info never fill a control —
              that is what put a rival green beside the brand action.
            </p>

            <div className="mt-4 rounded-2xl border border-line-200 bg-surface-base p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent">
                  Save changes
                </span>
                <span className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent">
                  Publish for ordering
                </span>
                <span className="rounded-full bg-danger-700 px-4 py-1.5 text-sm font-semibold text-on-accent">
                  Delete account
                </span>
                <span className="rounded-full border border-danger-700 px-4 py-1.5 text-sm font-semibold text-danger-800">
                  Remove photo
                </span>
                <span className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent opacity-40">
                  Saving…
                </span>
              </div>
              <Caption>
                accent-700 · accent-700 · danger-700 · danger-700 outline · disabled
              </Caption>
            </div>
          </section>

          <section aria-labelledby="inline" className="mt-10">
            <h2 id="inline" className="text-lg font-bold tracking-tight text-ink-900">
              Inline messages
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              The smallest appearances: validation, saved confirmations and review counts.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <p className="text-xs font-medium text-ink-600">Price</p>
                <p className="mt-1 rounded-lg border border-danger-300 bg-surface-base px-2.5 py-1.5 text-sm text-ink-900">
                  12,50
                </p>
                <p role="alert" className="mt-2 text-xs text-danger-700">
                  Use digits only, for example 12.50.
                </p>
                <Caption>field error · danger-300 border · danger-700 text</Caption>
              </div>

              <div className="rounded-2xl border border-line-200 bg-surface-base p-4">
                <p className="text-xs font-medium text-ink-600">Opening times</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-700">
                    Mon–Fri · 09:00–17:00
                  </span>
                  <span
                    role="status"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700"
                  >
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-success-700" />
                    Saved
                  </span>
                </div>
                <p className="mt-2 text-xs text-warning-800">
                  3 items need review before publishing.
                </p>
                <p className="mt-1 text-xs text-info-900">
                  Times are shown in the diner&apos;s zone.
                </p>
                <Caption>inline dot + ink-700 · warning-800 · info-900</Caption>
              </div>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 font-mono text-[11px] leading-4 text-ink-500">{children}</p>;
}

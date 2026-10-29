"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { MenuDocument } from "@/features/menu/schema";
import type { PublicationStatus } from "@/features/publishing/schema";

/**
 * The publish surface.
 *
 * Publishing means one thing: this menu becomes orderable at the café's
 * tables. There is no menu page to open, link, or share, so the panel shows
 * no URL, no QR code and no view count — a table card is the only way in.
 *
 * It never overstates the state of things — "Ordering open" only when table
 * ordering actually offers the menu, an explicit warning when draft edits are
 * not in the live snapshot yet, and a plain "Not published" when the row is
 * reserved but nothing is served. Publishing needs an account, so signed-out
 * owners get an explanation and a sign-in link instead of a dead button.
 */

export interface PublishingControls {
  /** Null = never published; `loaded` distinguishes that from "still loading". */
  status: PublicationStatus | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  /** Whether this menu exists in the signed-in account (required to publish). */
  inAccount: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
}

interface PublishPanelProps {
  signedIn: boolean;
  controls: PublishingControls;
  /** Opens the R1 publish wizard for a menu that is not in the account yet. */
  onStartWizard?: () => void;
}

const pill = "rounded-full px-2.5 py-0.5 text-[11px] font-semibold";

function StatusPill({ status }: { status: PublicationStatus | null }) {
  if (!status) {
    return <span className={`${pill} bg-stone-100 text-stone-600`}>Not published</span>;
  }
  if (!status.isLive) {
    return <span className={`${pill} bg-amber-100 text-amber-900`}>Ordering paused</span>;
  }
  return <span className={`${pill} bg-emerald-100 text-emerald-900`}>Ordering open</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PublishPanel({ signedIn, controls, onStartWizard }: PublishPanelProps) {
  const { status, loaded, busy, error, inAccount, onPublish, onUnpublish } = controls;
  const needsPublish = status?.isLive === true && status.hasUnpublishedChanges;
  const publishLabel = !status?.isLive
    ? "Publish for ordering"
    : needsPublish
      ? "Publish changes"
      : "Republish";

  if (!signedIn) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-900">Table ordering</h3>
          <StatusPill status={null} />
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-600">
          Publishing puts this menu on your tables: diners scan a table card, pick items, and the
          order lands on your board. Sign in inside the flow and your draft stays in this browser.
        </p>
        {onStartWizard ? (
          <button
            type="button"
            onClick={onStartWizard}
            className="mt-3 rounded-full bg-amber-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Set up table ordering
          </button>
        ) : (
          <a
            href="/sign-in"
            className="mt-3 inline-block text-xs font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Sign in to publish (free while the promotion lasts)
          </a>
        )}
      </div>
    );
  }

  if (!inAccount) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-900">Table ordering</h3>
          <StatusPill status={status} />
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-600">
          This menu is still only in this browser. One step adds it to your account and makes it
          orderable at your tables — we create your café if you don&apos;t have one yet.
        </p>
        {onStartWizard && (
          <button
            type="button"
            onClick={onStartWizard}
            className="mt-3 rounded-full bg-amber-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Set up table ordering
          </button>
        )}
        {error && (
          <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-stone-900">Table ordering</h3>
        <StatusPill status={status} />
        <span className="flex-1" />
        {loaded && (
          <button
            type="button"
            onClick={onPublish}
            disabled={busy}
            className="rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            {busy ? "Publishing…" : publishLabel}
          </button>
        )}
      </div>

      {!loaded && (
        <div role="status" aria-busy="true" className="mt-2 flex flex-col gap-2">
          <span className="sr-only">Checking whether this menu is being served…</span>
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      )}

      {loaded && !status && (
        <p className="mt-2 text-xs leading-5 text-stone-600">
          This menu has never been published. Publishing makes it orderable at your tables — print a
          table card from the Tables tab and diners can order from it.
        </p>
      )}

      {status && (
        <div className="mt-2 flex flex-col gap-2">
          {!status.isLive && (
            <p className="text-xs leading-5 text-stone-600">
              This menu is not being served right now, so table cards skip it. Publishing again puts
              it back on your tables.
            </p>
          )}

          {status.isLive && status.publishedAt && (
            <p className="text-xs text-stone-500">Published {formatDate(status.publishedAt)}</p>
          )}

          {needsPublish && (
            <>
              <p
                role="status"
                className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
              >
                Draft changes are not on your tables yet — diners still see the last published
                version until you press “Publish changes”.
              </p>
            </>
          )}

          {status.isLive && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Unpublish this menu? Table cards stop offering it, though the menu and its address stay reserved."
                  )
                ) {
                  onUnpublish();
                }
              }}
              disabled={busy}
              className="self-start rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {busy ? "Working…" : "Unpublish"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

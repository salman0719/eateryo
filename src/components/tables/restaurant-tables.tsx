"use client";

import { TableQrPanel } from "@/components/tables/table-qr-panel";
import { GuidanceCard } from "@/components/ui/guidance-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/features/tenancy/workspace-context";

/**
 * Restaurant-level table cards.
 *
 * A table code encodes the restaurant link (`/r/<slug>/t/<label>`), so the
 * cards belong to the restaurant, not to whichever menu was open when they
 * were printed. The panel therefore lives here, next to Orders: every member
 * (owner or staff) can print, while only an owner sees the claim action.
 *
 * The café is the shell's active membership — this page keeps no list of its
 * own and offers no second picker, so it cannot disagree with the switcher.
 */
export function RestaurantTables() {
  const workspace = useWorkspace();
  const { signedIn, sessionPending, restaurants, active } = workspace;
  const loadFailed = workspace.failedFor !== null;

  return (
    <div className="flex flex-col gap-4">
      <div data-print-hide>
        <h2 className="text-xl font-bold text-ink-900">Table QR codes</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-600">
          One code per table, for the whole restaurant. Each card opens that table&apos;s page with
          every menu that is open right now — so adding a lunch menu, republishing, or renaming a
          menu never makes a printed card out of date.
        </p>
      </div>

      {!signedIn && !sessionPending && (
        <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
          <p className="text-sm font-medium text-ink-900">Sign in to print table cards</p>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            Table cards point at your restaurant link, which lives in your account.
          </p>
          <a
            href="/sign-in"
            className="mt-3 inline-block rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            Sign in
          </a>
        </div>
      )}

      {signedIn && loadFailed && (
        <p className="text-xs text-danger-700">
          Could not load your restaurants. Check your connection and try again.{" "}
          <button
            type="button"
            onClick={() => workspace.refresh()}
            className="font-semibold text-danger-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-900"
          >
            Try again
          </button>
        </p>
      )}

      {(sessionPending || signedIn) && restaurants === null && (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading your restaurants…</span>
          <div className="rounded-2xl border border-line-200 bg-surface-base p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-9 w-full max-w-sm" />
            <Skeleton className="mt-3 h-3 w-3/5" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} className="aspect-square w-full rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {signedIn && !loadFailed && restaurants !== null && restaurants.length === 0 && (
        <GuidanceCard
          title="No restaurant yet"
          steps={[
            "Add a menu to your account from My menus — adding it creates the restaurant.",
            "Come back here to print one card per table.",
          ]}
          action={{ href: "/menus", label: "Go to My menus" }}
        />
      )}

      {signedIn && active && (
        <TableQrPanel
          key={active.restaurantId}
          context="restaurant"
          restaurantId={active.restaurantId}
          restaurantName={active.name}
          isOwner={workspace.can("tables.link")}
        />
      )}
    </div>
  );
}

import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { OrderShell, OrderSkeleton } from "@/components/order/order-menu";
import { TableLanding as TableLandingScreen } from "@/components/order/table-landing";
import { isSlug } from "@/features/publishing/slug";
import { normalizeTableLabel, formatTableLabel } from "@/features/orders/table-links";
import { listOpenMenusForRestaurantSlug, type TableLanding } from "@/features/tables/repo";
import { getDb } from "@/lib/db";

/**
 * Per-table landing (Steps 1–2): `/r/<restaurant>/t/<table>`.
 *
 * One QR code per table resolves here — not to a single menu. The page
 * lists every live menu for the restaurant: open ones (publication live +
 * availability covering now) as orderable tabs, and menus outside their
 * hours as disabled tabs that reveal their opening times, so a diner can
 * tell a closed menu from a missing one.
 *
 * No account, no cookie: a stranger's phone sees exactly the open menus.
 * Unknown restaurant slugs 404; a known restaurant with nothing open gets
 * an honest empty state instead of a dead page.
 */

const loadLanding = cache(async (restaurantSlug: string): Promise<TableLanding | null> => {
  if (!isSlug(restaurantSlug)) return null;
  return listOpenMenusForRestaurantSlug(getDb(), restaurantSlug, new Date());
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
}): Promise<Metadata> {
  const { restaurantSlug, tableLabel } = await params;
  // Time-dependent (menu open hours are judged at `now`): opt out of
  // prerendering so `new Date()` below is evaluated per request.
  await connection();
  const landing = await loadLanding(restaurantSlug);
  const label = normalizeTableLabel(decodeURIComponent(tableLabel));
  if (!landing) {
    return {
      title: "Restaurant link isn’t live · Eateryo",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: label
      ? `${landing.restaurantName} · ${formatTableLabel(label)} · Eateryo`
      : `${landing.restaurantName} · Eateryo`,
    robots: { index: false, follow: false },
  };
}

export default function TableLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<LandingLoading />}>
      <TableLandingContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function LandingLoading() {
  return (
    <OrderShell>
      <OrderSkeleton label="Finding this table’s menus…" />
    </OrderShell>
  );
}

async function TableLandingContent({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { restaurantSlug, tableLabel: rawLabel } = await params;
  const query = await searchParams;
  // A reload of a confirmation link carries `?track=`; hand it to the
  // client so its first paint is the loading state, not the menu tabs.
  // A Stripe return adds `?pay=success&session_id=…` (or `pay=cancelled`).
  const resumeToken =
    typeof query.track === "string" && query.track.length > 0 ? query.track : null;
  const payParam = typeof query.pay === "string" ? query.pay : null;
  const returnPay: "success" | "cancelled" | null =
    payParam === "success" || payParam === "cancelled" ? payParam : null;
  // Same per-request requirement as generateMetadata above.
  await connection();
  const sessionParam = typeof query.session_id === "string" ? query.session_id.trim() : "";
  const returnSessionId =
    returnPay === "success" && sessionParam.length >= 8 && sessionParam.length <= 200
      ? sessionParam
      : null;
  const landing = await loadLanding(restaurantSlug);
  if (!landing) notFound();

  const tableLabel = normalizeTableLabel(decodeURIComponent(rawLabel));
  if (!tableLabel) {
    return (
      <OrderShell>
        <div className="rounded-2xl border border-line-200 bg-surface-base p-8 text-center">
          <p className="text-lg font-semibold text-ink-900">This table link is incomplete</p>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            A table link includes the table number, like{" "}
            <code className="rounded bg-surface-100 px-1.5 py-0.5 text-xs">
              /r/{landing.restaurantSlug}/t/3
            </code>
            . Ask staff for a fresh QR code.
          </p>
        </div>
      </OrderShell>
    );
  }

  const frame = "rounded-2xl border border-line-200 bg-surface-base";

  if (landing.menus.length === 0 && landing.closedMenus.length === 0) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className={`${frame} p-5`}>
          <p className="text-sm font-semibold tracking-wider text-accent-700 uppercase">
            {landing.restaurantName} · {formatTableLabel(tableLabel)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">Order from your table</h1>
          <p className="mt-1 text-sm text-ink-600">Ask staff what’s being served right now.</p>
        </div>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-lg font-semibold text-ink-900">Nothing being served right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
            {landing.restaurantName} has no menu open at the moment — the kitchen may be between
            services. Ask staff what’s on, or try again a little later.
          </p>
        </div>
      </OrderShell>
    );
  }

  return (
    <TableLandingScreen
      restaurantName={landing.restaurantName}
      restaurantSlug={landing.restaurantSlug}
      restaurantLogo={landing.restaurantLogo}
      restaurantCover={landing.restaurantCover}
      restaurantTheme={landing.restaurantTheme}
      tableLabel={tableLabel}
      menus={landing.menus.map((menu) => ({
        menuId: menu.menuId,
        menuSlug: menu.menuSlug,
        title: menu.title,
        doc: menu.doc,
      }))}
      closedMenus={landing.closedMenus}
      resumeToken={resumeToken}
      returnPay={returnPay}
      returnSessionId={returnSessionId}
    />
  );
}

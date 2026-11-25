import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import type { BrandAssetImage } from "@/features/brand-assets/schema";
import { DinerThemeProvider } from "@/components/order/diner-theme";
import { DinerSplash, OrderShell } from "@/components/order/order-menu";
import { TableLandingBody } from "@/components/order/table-landing";
import { isSlug } from "@/features/publishing/slug";
import { normalizeTableLabel, formatTableLabel } from "@/features/orders/table-links";
import { getRestaurantBySlug, listLandingMenus } from "@/features/tables/repo";
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

const loadIdentity = cache(async (restaurantSlug: string) => {
  if (!isSlug(restaurantSlug)) return null;
  return getRestaurantBySlug(getDb(), restaurantSlug);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
}): Promise<Metadata> {
  const { restaurantSlug, tableLabel } = await params;
  // The title names the restaurant only; the time-dependent open-hours
  // judgement lives in the page content. Still per-request, like the page.
  await connection();
  const identity = await loadIdentity(restaurantSlug);
  const label = normalizeTableLabel(decodeURIComponent(tableLabel));
  if (!identity) {
    return {
      title: "Restaurant link isn’t live · Eateryo",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: label
      ? `${identity.name} · ${formatTableLabel(label)} · Eateryo`
      : `${identity.name} · Eateryo`,
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

/**
 * The static shell: fully prerenderable (no params, no data), so a direct
 * QR visit paints instantly. Neutral brand splash — the Eateryo lockup on
 * the shipped wash. The same splash repaints themed the moment the
 * identity row answers (inside `DinerThemeProvider`), then menus stream
 * in behind it.
 */
function LandingLoading() {
  return (
    <OrderShell bare>
      <DinerSplash label="Finding this table's menus…" />
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
  const identity = await loadIdentity(restaurantSlug);
  if (!identity) notFound();

  const tableLabel = normalizeTableLabel(decodeURIComponent(rawLabel));
  if (!tableLabel) {
    return (
      <DinerThemeProvider theme={identity.dinerTheme} className="min-h-screen">
        <OrderShell bare>
          <div className="rounded-2xl border border-line-200 bg-surface-base p-8 text-center">
            <p className="text-lg font-semibold text-ink-900">This table link is incomplete</p>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              A table link includes the table number, like{" "}
              <code className="rounded bg-surface-100 px-1.5 py-0.5 text-xs">
                /r/{identity.slug}/t/3
              </code>
              . Ask staff for a fresh QR code.
            </p>
          </div>
        </OrderShell>
      </DinerThemeProvider>
    );
  }

  return (
    <DinerThemeProvider theme={identity.dinerTheme} className="min-h-screen">
      <OrderShell bare>
        <Suspense
          fallback={
            resumeToken ? (
              <DinerSplash label="Finding your order…" />
            ) : (
              <DinerSplash label="Loading this restaurant’s menus…" />
            )
          }
        >
          <LandingMenus
            restaurantId={identity.id}
            restaurantName={identity.name}
            restaurantSlug={identity.slug}
            restaurantLogo={identity.logo}
            restaurantCover={identity.cover}
            tableLabel={tableLabel}
            resumeToken={resumeToken}
            returnPay={returnPay}
            returnSessionId={returnSessionId}
          />
        </Suspense>
      </OrderShell>
    </DinerThemeProvider>
  );
}

async function LandingMenus({
  restaurantId,
  restaurantName,
  restaurantSlug,
  restaurantLogo,
  restaurantCover,
  tableLabel,
  resumeToken,
  returnPay,
  returnSessionId,
}: {
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  restaurantLogo: BrandAssetImage | null;
  restaurantCover: BrandAssetImage | null;
  tableLabel: string;
  resumeToken: string | null;
  returnPay: "success" | "cancelled" | null;
  returnSessionId: string | null;
}) {
  // Same per-request requirement as above: menu windows are judged at now.
  await connection();
  const { menus, closedMenus } = await listLandingMenus(getDb(), restaurantId, new Date());

  const frame = "rounded-2xl border border-line-200 bg-surface-base";

  if (menus.length === 0 && closedMenus.length === 0) {
    return (
      <>
        <div className={`${frame} p-5`}>
          <p className="text-sm font-semibold tracking-wider text-accent-700 uppercase">
            {restaurantName} · {formatTableLabel(tableLabel)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">Order from your table</h1>
          <p className="mt-1 text-sm text-ink-600">Ask staff what’s being served right now.</p>
        </div>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-lg font-semibold text-ink-900">Nothing being served right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
            {restaurantName} has no menu open at the moment — the kitchen may be between services.
            Ask staff what’s on, or try again a little later.
          </p>
        </div>
      </>
    );
  }

  return (
    <TableLandingBody
      restaurantName={restaurantName}
      restaurantSlug={restaurantSlug}
      restaurantLogo={restaurantLogo}
      restaurantCover={restaurantCover}
      tableLabel={tableLabel}
      menus={menus.map((menu) => ({
        menuId: menu.menuId,
        menuSlug: menu.menuSlug,
        title: menu.title,
        doc: menu.doc,
      }))}
      closedMenus={closedMenus}
      resumeToken={resumeToken}
      returnPay={returnPay}
      returnSessionId={returnSessionId}
    />
  );
}

import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  describePublishedMenu,
  PublishedMenuView,
} from "@/components/menu/published-menu";
import { getPublishedMenuByPath } from "@/features/publishing/repo";
import { restaurantPath } from "@/features/publishing/schema";
import { isSlug } from "@/features/publishing/slug";
import { getDb } from "@/lib/db";

/**
 * Targeted public menu page (Step 9, `/r/<restaurant>/m/<menu>`).
 *
 * The address is scoped to the café that publishes it: menu slugs are only
 * unique inside one restaurant, so two cafés can both publish `lunch`
 * under their own `/r/` address. This link always works for a live menu,
 * including the one a single-menu café also serves at `/r/<restaurant>`.
 *
 * Only live publications exist here: unpublished or unknown addresses get a
 * 404, and the café's slug stays reserved either way. Rendering shared with
 * the primary-menu page lives in `PublishedMenuView`. A café with several
 * live menus also offers a link back to its list here (`liveMenuCount`).
 */

/** De-duplicates the slug lookup between metadata and the page render. */
const loadPublishedMenu = cache(
  async (restaurantSlug: string, slug: string) => {
    if (!isSlug(restaurantSlug) || !isSlug(slug)) return null;
    return getPublishedMenuByPath(getDb(), restaurantSlug, slug);
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}): Promise<Metadata> {
  const { restaurantSlug, menuSlug } = await params;
  const page = await loadPublishedMenu(restaurantSlug, menuSlug);
  if (!page) {
    return {
      title: "Menu not published · Eateryo",
      robots: { index: false, follow: false },
    };
  }
  const title = page.doc.title.trim() || "Menu";
  const description = describePublishedMenu(page.doc, page.restaurantName);
  return {
    title: `${title} · Eateryo`,
    description,
    // Noindex by default: a café opts into being found later, not by
    // publishing a link for its own tables.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", siteName: "Eateryo" },
    twitter: { card: "summary", title, description },
  };
}

/**
 * Under Cache Components the address and the database read are request-time
 * data, so the page is a static shell plus a streamed menu: the visitor sees
 * the page frame immediately and the menu fills in as soon as the query
 * returns. Reading the DB at the top level of the page would block the whole
 * response, which the build rejects.
 */
export default function PublishedMenuPage({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <PublishedMenu params={params} />
    </Suspense>
  );
}

function MenuSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <span className="sr-only">Loading the menu…</span>
      <div className="animate-pulse rounded-2xl bg-stone-100 px-6 py-16" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
      </div>
    </main>
  );
}

async function PublishedMenu({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}) {
  const { restaurantSlug, menuSlug } = await params;
  const page = await loadPublishedMenu(restaurantSlug, menuSlug);
  if (!page) notFound();

  // Several live menus make the café's own address the menu list, so this
  // page offers a way back to it. With one live menu the root is this same
  // menu, and a "back" would only reload it.
  return (
    <PublishedMenuView
      page={page}
      menusHref={page.liveMenuCount > 1 ? restaurantPath(page.restaurantSlug) : undefined}
    />
  );
}

import { Suspense, cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { describePublishedMenu, PublishedMenuView } from "@/components/menu/published-menu";
import {
  getPublishedMenusForRestaurant,
  type PublishedMenuIndex,
} from "@/features/publishing/repo";
import { isSlug } from "@/features/publishing/slug";
import { publicationPath, restaurantPath } from "@/features/publishing/schema";
import { getDb } from "@/lib/db";

/**
 * The café's own public page (`/r/<restaurant>`).
 *
 * A restaurant with exactly one live menu serves that menu here — it is the
 * primary one by derivation, with no picker and no owner choice — so the
 * short address is the link to put on a door, a website, or a Google
 * profile. The menu's targeted `/r/<restaurant>/m/<menu>` address keeps
 * working at the same time.
 *
 * A restaurant with several live menus has no single "main" menu, so this
 * page lists them with links to their targeted addresses instead of guessing
 * which one a visitor meant. Unknown cafés and cafés with nothing live get
 * the segment's not-found page: a link that serves nothing says so.
 */

/** De-duplicates the lookup between metadata and the page render. */
const loadRestaurantMenus = cache(async (restaurantSlug: string) => {
  if (!isSlug(restaurantSlug)) return null;
  return getPublishedMenusForRestaurant(getDb(), restaurantSlug);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string }>;
}): Promise<Metadata> {
  const { restaurantSlug } = await params;
  const index = await loadRestaurantMenus(restaurantSlug);
  if (!index || index.menus.length === 0) {
    return {
      title: "Restaurant link isn’t live · Eateryo",
      robots: { index: false, follow: false },
    };
  }
  const primary = index.menus.length === 1 ? index.menus[0] : null;
  const title = primary
    ? primary.doc.title.trim() || "Menu"
    : `${index.restaurantName} · Menus`;
  const description = primary
    ? describePublishedMenu(primary.doc, index.restaurantName)
    : `The menus ${index.restaurantName} is serving.`;
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

export default function RestaurantPage({
  params,
}: {
  params: Promise<{ restaurantSlug: string }>;
}) {
  return (
    <Suspense fallback={<RestaurantSkeleton />}>
      <RestaurantContent params={params} />
    </Suspense>
  );
}

function RestaurantSkeleton() {
  return (
    <main
      aria-busy="true"
      className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12"
    >
      <span className="sr-only">Loading the menu…</span>
      <div className="animate-pulse rounded-2xl bg-stone-100 px-6 py-16" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
      </div>
    </main>
  );
}

async function RestaurantContent({
  params,
}: {
  params: Promise<{ restaurantSlug: string }>;
}) {
  const { restaurantSlug } = await params;
  const index = await loadRestaurantMenus(restaurantSlug);
  if (!index || index.menus.length === 0) notFound();

  const [primary] = index.menus;
  if (index.menus.length === 1 && primary) {
    // Exactly one live menu: this address is that menu's page.
    return (
      <PublishedMenuView
        page={{
          ...primary,
          restaurantName: index.restaurantName,
          restaurantSlug: index.restaurantSlug,
        }}
      />
    );
  }

  return <MenuIndex index={index} />;
}

/**
 * Several live menus: show the addresses a visitor can choose from, in the
 * order the query returns (menu title), with nothing invented.
 */
function MenuIndex({ index }: { index: PublishedMenuIndex }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-14">
      <p className="text-center text-[11px] font-semibold tracking-[0.25em] text-stone-400 uppercase">
        {index.restaurantName}
      </p>
      <h1 className="mt-3 text-center text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
        Our menus
      </h1>
      <p className="mx-auto mt-2 max-w-md text-center text-sm leading-6 text-stone-600">
        {index.menus.length} menus from {index.restaurantName} — pick the one you want.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {index.menus.map((menu) => {
          const items = menu.doc.categories.reduce(
            (sum, category) => sum + category.items.length,
            0
          );
          return (
            <li key={menu.menuId}>
              <Link
                href={publicationPath(index.restaurantSlug, menu.slug)}
                className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 transition-colors hover:border-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                <span className="text-lg font-semibold text-stone-900">
                  {menu.doc.title.trim() || "Untitled menu"}
                </span>
                <span className="mt-1 text-sm text-stone-500">
                  {items} {items === 1 ? "item" : "items"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <footer className="mt-10 border-t border-stone-200 pt-4 text-center text-xs text-stone-500">
        <p>
          {restaurantPath(index.restaurantSlug)} · Published with Eateryo
        </p>
      </footer>
    </main>
  );
}

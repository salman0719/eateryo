import { MenuPreview } from "@/components/menu-editor/menu-preview";
import { ViewCounter } from "@/components/menu-editor/view-counter";
import type { MenuDocument } from "@/features/menu/schema";
import type { PublishedMenuPage } from "@/features/publishing/repo";

/**
 * The public menu surface, shared by both addresses that serve it: the
 * café's own `/r/<restaurant>` page (when it publishes exactly one menu) and
 * the targeted `/r/<restaurant>/m/<menu>` page.
 *
 * It renders the stored revision snapshot — never the live menu document — so
 * an owner's later edits cannot change what a diner sees until "Publish
 * changes" is pressed. Review notes and AI review badges never render
 * (MenuPreview is the diner surface), and missing prices stay honest.
 *
 * No account, no cookie, and no client data is required: a stranger's phone
 * sees exactly the themed menu.
 */

function itemCount(doc: Pick<MenuDocument, "categories">): number {
  return doc.categories.reduce((sum, category) => sum + category.items.length, 0);
}

/** The description both public pages use for metadata and previews. */
export function describePublishedMenu(
  doc: Pick<MenuDocument, "categories">,
  restaurant: string
): string {
  const items = itemCount(doc);
  if (items === 0) return `The menu for ${restaurant}.`;
  return `${items} ${items === 1 ? "item" : "items"} across ${doc.categories.length} ${
    doc.categories.length === 1 ? "category" : "categories"
  } — ${restaurant}.`;
}

export function PublishedMenuView({ page }: { page: PublishedMenuPage }) {
  const title = page.doc.title.trim() || "Untitled menu";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
        <p className="mb-3 text-center text-[11px] font-semibold tracking-[0.25em] text-stone-400 uppercase">
          {page.restaurantName}
        </p>
        <MenuPreview doc={page.doc} themeId={page.theme} layout={page.layout} eyebrow="Menu" />
        <ViewCounter restaurantSlug={page.restaurantSlug} slug={page.slug} />
        <footer className="mt-8 border-t border-stone-200 pt-4 text-center text-xs text-stone-500">
          <p>
            {title} · menu updated{" "}
            <time dateTime={page.publishedAt}>
              {new Date(page.publishedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </p>
          <p className="mt-1">Published with Eateryo</p>
        </footer>
      </main>
    </div>
  );
}

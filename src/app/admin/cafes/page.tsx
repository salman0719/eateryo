/**
 * Cafés list (B3) — every café on the platform, read-only.
 *
 * Server-rendered per request behind the layout guard, straight from
 * `listCafes`: search by name or slug, filter live vs draft, newest
 * first with keyset pages. The page says it is read-only — changes
 * happen in the café app, never here.
 */

import Link from "next/link";

import { getDb } from "@/lib/db";
import { listCafes, type CafeLiveFilter } from "@/features/platform/repo";
import { decodeAdminCursor } from "@/features/platform/schema";

// Like the layout guard above: this page reads per request, never prerenders.
// Without it a client-side navigation trips Next 16's blocking-prerender error.
export const instant = false;

const LIVES: { value: CafeLiveFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "draft", label: "Draft" },
];

function isLive(value: string): value is CafeLiveFilter {
  return LIVES.some((entry) => entry.value === value);
}

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "—"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface SearchParams {
  q?: string;
  live?: string;
  cursor?: string;
}

export default async function AdminCafesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ? params.q.trim() : undefined;
  const live: CafeLiveFilter = params.live && isLive(params.live) ? params.live : "all";

  const rawCursor = params.cursor;
  const cursor = decodeAdminCursor(rawCursor ?? undefined);

  if (rawCursor && !cursor) {
    return (
      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cafés</h1>
          <p className="mt-1 text-sm text-ink-600">That page cursor is not valid.</p>
        </div>
        <p>
          <Link href="/admin/cafes" className="text-sm font-medium text-accent-800 underline">
            Back to the first page
          </Link>
        </p>
      </section>
    );
  }

  const page = await listCafes(getDb(), { q, live, cursor });

  const pageQuery = (nextCursor?: string): string => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (live !== "all") next.set("live", live);
    if (nextCursor) next.set("cursor", nextCursor);
    const text = next.toString();
    return text ? `/admin/cafes?${text}` : "/admin/cafes";
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cafés</h1>
        <p className="mt-1 text-sm text-ink-600">
          Read-only — every café on the platform. Changes happen in the café app, never here.
        </p>
      </div>

      <form
        method="get"
        action="/admin/cafes"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-line-200 bg-surface-50 p-4"
      >
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-ink-500">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="name or slug"
            maxLength={120}
            className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          Menu state
          <select
            name="live"
            defaultValue={live}
            className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
          >
            {LIVES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Apply
        </button>
      </form>

      {page.cafes.length === 0 ? (
        <p className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm text-ink-600">
          No cafés match — try clearing the search or choosing a different filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.cafes.map((cafe) => (
            <li
              key={cafe.id}
              className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3"
            >
              <span className="min-w-0 text-sm">
                <Link
                  href={`/admin/cafes/${cafe.id}`}
                  className="font-medium text-accent-800 underline"
                >
                  {cafe.name}
                </Link>
                {cafe.slug ? (
                  <span className="block truncate text-xs text-ink-500">/r/{cafe.slug}</span>
                ) : null}
                <span className="mt-1 block text-xs tabular-nums text-ink-600">
                  {cafe.memberCount} {cafe.memberCount === 1 ? "member" : "members"} ·{" "}
                  {cafe.menuCount} {cafe.menuCount === 1 ? "menu" : "menus"} · {cafe.liveCount} live
                  · {cafe.orders7} orders · 7d
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {cafe.ownerSuspended ? (
                  <span className="rounded-full border border-line-200 px-2 py-0.5 text-xs font-semibold text-ink-900">
                    Owner suspended
                  </span>
                ) : null}
                <span className="text-xs tabular-nums text-ink-500">
                  {shortDate(cafe.createdAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <p>
          <Link
            href={pageQuery(page.nextCursor)}
            className="text-sm font-medium text-accent-800 underline"
          >
            Next page
          </Link>
        </p>
      ) : null}
    </section>
  );
}

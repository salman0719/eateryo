/**
 * Accounts list (B3) — search, filter, sort, keyset pages.
 *
 * Server-rendered per request behind the layout guard: the query comes
 * from the URL so every view is linkable, and the rows come straight
 * from `listAccounts` — no new API shape, no client fetch. An invalid
 * cursor renders as an error with a reset link, never a silent restart.
 */

import Link from "next/link";

import { getDb } from "@/lib/db";
import { listAccounts } from "@/features/platform/repo";
import { decodeAdminCursor } from "@/features/platform/schema";
import type {
  AdminAccountFilter,
  AdminAccountSort,
  AdminAccountSummary,
} from "@/features/platform/schema";

// Like the layout guard above: this page reads per request, never prerenders.
// Without it a client-side navigation trips Next 16's blocking-prerender error.
export const instant = false;

const FILTERS: { value: AdminAccountFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "taking_orders", label: "Taking orders" },
  { value: "not_onboarded", label: "Not onboarded" },
  { value: "suspended", label: "Suspended" },
  { value: "no_password", label: "No password" },
  { value: "reset_required", label: "Reset required" },
  { value: "locked", label: "Locked out" },
];

const ACCESS_CHIPS: Record<AdminAccountSummary["accessChip"], { label: string; dot: string }> = {
  locked: { label: "Locked out", dot: "bg-danger-500" },
  reset_required: { label: "Reset required", dot: "bg-warning-500" },
  no_password: { label: "No password", dot: "bg-ink-300" },
  password_set: { label: "Password set", dot: "bg-success-500" },
};

const SORTS: { value: AdminAccountSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "active", label: "Recently active" },
  { value: "orders", label: "Orders · 7 days" },
];

function isFilter(value: string): value is AdminAccountFilter {
  return FILTERS.some((entry) => entry.value === value);
}

function isSort(value: string): value is AdminAccountSort {
  return SORTS.some((entry) => entry.value === value);
}

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "—"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function accountName(name: string, email: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed : email;
}

interface SearchParams {
  q?: string;
  filter?: string;
  sort?: string;
  cursor?: string;
}

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ? params.q.trim() : undefined;
  const filter: AdminAccountFilter =
    params.filter && isFilter(params.filter) ? params.filter : "all";
  const sort: AdminAccountSort = params.sort && isSort(params.sort) ? params.sort : "newest";

  const rawCursor = params.cursor;
  const cursor = decodeAdminCursor(rawCursor ?? undefined);

  if (rawCursor && !cursor) {
    return (
      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="mt-1 text-sm text-ink-600">That page cursor is not valid.</p>
        </div>
        <p>
          <Link href="/admin/accounts" className="text-sm font-medium text-accent-800 underline">
            Back to the first page
          </Link>
        </p>
      </section>
    );
  }

  const page = await listAccounts(getDb(), {
    q,
    filter,
    sort,
    cursor,
  });

  const pageQuery = (nextCursor?: string): string => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (filter !== "all") next.set("filter", filter);
    if (sort !== "newest") next.set("sort", sort);
    if (nextCursor) next.set("cursor", nextCursor);
    const text = next.toString();
    return text ? `/admin/accounts?${text}` : "/admin/accounts";
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-ink-600">
          Every account on the platform — search by name or email, filter by stage or sign-in state,
          sort by signup, activity or volume.
        </p>
      </div>

      <form
        method="get"
        action="/admin/accounts"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-line-200 bg-surface-50 p-4"
      >
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-ink-500">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="name or email"
            maxLength={120}
            className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          Filter
          <select
            name="filter"
            defaultValue={filter}
            className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
          >
            {FILTERS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          Sort
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
          >
            {SORTS.map((entry) => (
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

      {page.accounts.length === 0 ? (
        <p className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm text-ink-600">
          No accounts match — try clearing the search or choosing a different filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3"
            >
              <span className="min-w-0 text-sm">
                <Link
                  href={`/admin/accounts/${account.id}`}
                  className="font-medium text-accent-800 underline"
                >
                  {accountName(account.name, account.email)}
                </Link>
                <span className="block truncate text-xs text-ink-500">{account.email}</span>
                <span className="mt-1 block text-xs tabular-nums text-ink-600">
                  {account.cafeCount} {account.cafeCount === 1 ? "café" : "cafés"} ·{" "}
                  {account.menuCount} menus · {account.liveCount} live · {account.orders7} orders ·
                  7d · {account.stage.replace("_", " ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {account.suspended ? (
                  <span className="rounded-full border border-line-200 px-2 py-0.5 text-xs font-semibold text-ink-900">
                    Suspended
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line-200 px-2 py-0.5 text-xs font-semibold text-ink-900">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${ACCESS_CHIPS[account.accessChip].dot}`}
                  />
                  {ACCESS_CHIPS[account.accessChip].label}
                </span>
                <span className="text-xs tabular-nums text-ink-500">
                  {shortDate(account.createdAt)}
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

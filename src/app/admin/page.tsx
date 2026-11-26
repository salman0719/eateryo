import Link from "next/link";

import { getDb } from "@/lib/db";
import { getPlatformOverview, listAccounts, listPlatformEvents } from "@/features/platform/repo";
import type { AccountStage } from "@/features/platform/stage";

// Like the layout guard above: this page reads per request, never prerenders.
// Without it a client-side navigation trips Next 16's blocking-prerender error.
export const instant = false;

/**
 * Admin overview (B3) — “is the platform healthy?” in one screen.
 *
 * Server-rendered per request behind the layout guard: KPIs, the
 * five-step onboarding funnel, the needs-attention queue (open
 * suspensions + sign-ups stalled past a week), recent operator actions
 * and recent sign-ups. Nothing here edits anything; every row links
 * to the account or the log it came from.
 */

const STAGE_LABELS: Record<AccountStage, string> = {
  signed_up: "Signed up",
  cafe: "Café created",
  menu: "Menu drafted",
  published: "Published",
  ordering: "Ordering",
};

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

export default async function AdminOverviewPage() {
  const db = getDb();
  const [overview, suspended, signups, activity] = await Promise.all([
    getPlatformOverview(db),
    listAccounts(db, { filter: "suspended" }),
    listAccounts(db, { sort: "newest" }),
    listPlatformEvents(db, {}),
  ]);

  const { totals, funnel, stalledSignups } = overview;
  const kpis = [
    { label: "Accounts", value: totals.accounts },
    { label: "Suspended", value: totals.suspended },
    { label: "Cafés", value: totals.cafes },
    { label: "Live menus", value: totals.liveMenus },
    { label: "Orders · 7 days", value: totals.orders7 },
  ];
  const attentionCount = suspended.accounts.length + stalledSignups.length;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform overview</h1>
        <p className="mt-1 text-sm text-ink-600">
          Derived live from the platform tables — nothing here is stored, so nothing can drift.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Key numbers</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-line-200 bg-surface-50 p-4">
              <dt className="text-xs text-ink-500">{kpi.label}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{kpi.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Onboarding funnel
        </h2>
        <ol className="mt-2 flex flex-col gap-2">
          {funnel.map((entry) => (
            <li
              key={entry.stage}
              className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3"
            >
              <span className="text-sm font-medium">{STAGE_LABELS[entry.stage]}</span>
              <span className="text-sm tabular-nums text-ink-600">
                {entry.count}
                {totals.accounts > 0 && (
                  <span className="text-ink-500">
                    {" "}
                    · {Math.round((entry.count / totals.accounts) * 100)}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Needs attention{attentionCount > 0 && ` · ${attentionCount}`}
        </h2>
        {attentionCount === 0 ? (
          <p className="mt-2 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm text-ink-600">
            Nothing needs attention: no open suspensions, no sign-up stalled past a week.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {suspended.accounts.slice(0, 5).map((account) => (
              <li
                key={account.id}
                className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3"
              >
                <span className="text-sm">
                  <span className="font-semibold">Suspended</span>
                  {" · "}
                  <Link
                    href={`/admin/accounts/${account.id}`}
                    className="font-medium text-accent-800 underline"
                  >
                    {accountName(account.name, account.email)}
                  </Link>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {account.suspendedAt ? shortDate(account.suspendedAt) : ""}
                </span>
              </li>
            ))}
            {stalledSignups.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3"
              >
                <span className="text-sm">
                  <span className="font-semibold">Stalled sign-up</span>
                  {" · "}
                  <Link
                    href={`/admin/accounts/${row.id}`}
                    className="font-medium text-accent-800 underline"
                  >
                    {accountName(row.name, row.email)}
                  </Link>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {shortDate(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Recent operator actions
            </h2>
            <Link href="/admin/activity" className="text-sm font-medium text-accent-800 underline">
              Full log
            </Link>
          </div>
          {activity.events.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm text-ink-600">
              No operator actions recorded yet.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {activity.events.slice(0, 5).map((event) => (
                <li
                  key={event.id}
                  className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm"
                >
                  <span className="font-medium">{event.action}</span>
                  <span className="text-ink-600"> · {event.actorEmail}</span>
                  {event.targetEmail && (
                    <span className="text-ink-600"> → {event.targetEmail}</span>
                  )}
                  <span className="block text-xs tabular-nums text-ink-500">
                    {shortDate(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Recent sign-ups
            </h2>
            <Link href="/admin/accounts" className="text-sm font-medium text-accent-800 underline">
              All accounts
            </Link>
          </div>
          {signups.accounts.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm text-ink-600">
              No accounts yet.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {signups.accounts.slice(0, 5).map((account) => (
                <li
                  key={account.id}
                  className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm"
                >
                  <Link
                    href={`/admin/accounts/${account.id}`}
                    className="font-medium text-accent-800 underline"
                  >
                    {accountName(account.name, account.email)}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {shortDate(account.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

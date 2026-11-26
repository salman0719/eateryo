/**
 * Operator log (B3) — every recorded operator action, newest first.
 *
 * Server-rendered per request behind the layout guard, straight from
 * `listPlatformEvents`: the action filter takes one of the recorded
 * base-four actions, pages are keyset-addressed so concurrent writes
 * hold no duplicates and no gaps. Reads are not logged — the log
 * records what changed, never who looked.
 */

import Link from "next/link";

import { getDb } from "@/lib/db";
import { PLATFORM_EVENT_ACTIONS } from "@/lib/db/schema";
import { listPlatformEvents } from "@/features/platform/repo";
import { decodeAdminCursor } from "@/features/platform/schema";

// Like the layout guard above: this page reads per request, never prerenders.
// Without it a client-side navigation trips Next 16's blocking-prerender error.
export const instant = false;

const ACTION_LABELS: Record<string, string> = {
  "account.suspended": "Account suspended",
  "account.restored": "Account restored",
  "operator.granted": "Operator granted",
  "operator.access_revoked": "Operator access revoked",
};

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "—"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface SearchParams {
  action?: string;
  cursor?: string;
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const action = params.action?.trim()
    ? (PLATFORM_EVENT_ACTIONS as readonly string[]).includes(params.action.trim())
      ? (params.action.trim() as (typeof PLATFORM_EVENT_ACTIONS)[number])
      : null
    : undefined;

  const rawCursor = params.cursor;
  const cursor = decodeAdminCursor(rawCursor ?? undefined);

  if ((params.action?.trim() && action === null) || (rawCursor && !cursor)) {
    return (
      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-ink-600">
            {params.action?.trim() && action === null
              ? "That action filter is not valid."
              : "That page cursor is not valid."}
          </p>
        </div>
        <p>
          <Link href="/admin/activity" className="text-sm font-medium text-accent-800 underline">
            Back to the full log
          </Link>
        </p>
      </section>
    );
  }

  const page = await listPlatformEvents(getDb(), { action: action ?? undefined, cursor });

  const pageQuery = (nextCursor?: string): string => {
    const next = new URLSearchParams();
    if (action) next.set("action", action);
    if (nextCursor) next.set("cursor", nextCursor);
    const text = next.toString();
    return text ? `/admin/activity?${text}` : "/admin/activity";
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-ink-600">
          The operator audit log — what changed, newest first. Reads are never logged.
        </p>
      </div>

      <form
        method="get"
        action="/admin/activity"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-line-200 bg-surface-50 p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          Action
          <select
            name="action"
            defaultValue={action ?? ""}
            className="rounded-lg border border-line-200 bg-surface-base px-3 py-2 text-sm text-ink-900"
          >
            <option value="">All actions</option>
            {PLATFORM_EVENT_ACTIONS.map((name) => (
              <option key={name} value={name}>
                {ACTION_LABELS[name] ?? name}
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

      {page.events.length === 0 ? (
        <p className="rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm text-ink-600">
          No operator actions recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.events.map((event) => (
            <li
              key={event.id}
              className="flex items-baseline justify-between gap-4 rounded-2xl border border-line-200 bg-surface-50 px-4 py-3 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{ACTION_LABELS[event.action] ?? event.action}</span>
                <span className="block truncate text-xs text-ink-500">
                  {event.actorEmail ?? "the CLI"}
                  {event.targetEmail ? ` → ${event.targetEmail}` : ""}
                  {event.detail ? ` · ${event.detail}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-500">
                {shortDate(event.createdAt)}
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

/**
 * Account detail (B3 shell, B4 Access card) — everything support needs
 * to answer for one account.
 *
 * Server-rendered per request behind the layout guard, straight from
 * `getAccountDetail`: identity and stage, the suspension banner, the
 * Access card with the suspend/restore actions plus the B4 sign-in chip
 * (password state, forced reset, lockout) with its two audited actions,
 * then the evidence — cafés and roles, menus with live state, extraction
 * usage, orders, sessions, timeline and the operator log. Unknown ids
 * are the plain 404; sessions carry no addresses, notes stay internal,
 * and no hash or token ever reaches this page.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessActions } from "@/components/platform/access-actions";
import { SuspendActions } from "@/components/platform/suspend-dialog";
import { getAccountDetail, PlatformRepoError } from "@/features/platform/repo";
import type { AccessChip } from "@/features/platform/schema";
import { getDb } from "@/lib/db";

// Like the layout guard above: this page reads per request, never prerenders.
// Without it a client-side navigation trips Next 16's blocking-prerender error.
export const instant = false;

const STAGE_LABELS: Record<string, string> = {
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

function shortDateTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "—"
    : at.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const ACCESS_CHIPS: Record<AccessChip, { label: string; dot: string }> = {
  locked: { label: "Locked out", dot: "bg-danger-500" },
  reset_required: { label: "Reset required", dot: "bg-warning-500" },
  no_password: { label: "No password yet", dot: "bg-ink-300" },
  password_set: { label: "Password set", dot: "bg-success-500" },
};

function accountName(name: string, email: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed : email;
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line-200 bg-surface-50 p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-500">{sub}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail;
  try {
    detail = await getAccountDetail(getDb(), id);
  } catch (error) {
    if (error instanceof PlatformRepoError && error.code === "not_found") notFound();
    throw error;
  }

  const displayName = accountName(detail.account.name, detail.account.email);
  const usagePct =
    detail.usage.cap > 0 ? Math.round((detail.usage.requests / detail.usage.cap) * 100) : 0;

  return (
    <section className="flex flex-col gap-6">
      <p>
        <Link href="/admin/accounts" className="text-sm font-medium text-accent-800 underline">
          All accounts
        </Link>
      </p>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
        <p className="mt-1 text-sm text-ink-600">{detail.account.email}</p>
        <p className="mt-1 text-xs tabular-nums text-ink-500">
          {STAGE_LABELS[detail.stage] ?? detail.stage} · joined{" "}
          {shortDate(detail.account.createdAt)}
        </p>
      </div>

      {detail.suspension ? (
        <div className="rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3">
          <p className="text-sm font-semibold text-danger-900">
            Suspended · {detail.suspension.reason.replace(/_/g, " ")}
          </p>
          <p className="mt-1 text-xs text-danger-800">
            Since {shortDate(detail.suspension.suspendedAt)}. Sign-in is blocked on every device.
            Published menus still serve diners.
          </p>
        </div>
      ) : null}

      <Card
        title="Access"
        sub="Account-scoped: sign-in and owner changes stop, diners keep ordering."
      >
        {detail.suspension ? (
          <p className="text-sm text-ink-600">
            Suspended since {shortDate(detail.suspension.suspendedAt)}. Restoring lets this account
            sign in again immediately — the suspension stays in the log.
          </p>
        ) : (
          <p className="text-sm text-ink-600">
            Active. Suspending blocks sign-in on every device and revokes active sessions. Published
            menus keep serving diners.
          </p>
        )}
        <SuspendActions
          accountId={detail.account.id}
          accountName={displayName}
          suspended={detail.suspension !== null}
        />
        <div className="mt-4 border-t border-line-100 pt-4">
          <p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-200 px-2 py-0.5 text-xs font-semibold text-ink-900">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${ACCESS_CHIPS[detail.access.chip].dot}`}
              />
              {ACCESS_CHIPS[detail.access.chip].label}
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs tabular-nums text-ink-600">
            <li>
              Sign-in methods: emailed link
              {detail.access.passwordSetAt ? " · password" : " · no password yet"}
            </li>
            {detail.access.passwordSetAt ? (
              <li>Password set {shortDate(detail.access.passwordSetAt)}</li>
            ) : null}
            {detail.access.resetRequired ? (
              <li>
                Reset forced{" "}
                {detail.access.resetSentAt ? shortDate(detail.access.resetSentAt) : "—"} — a reset
                link was emailed to the account.
              </li>
            ) : null}
            {detail.access.locked && detail.access.lockedUntil ? (
              <li>
                Locked until {shortDateTime(detail.access.lockedUntil)} ·{" "}
                {detail.access.failedAttempts} failed{" "}
                {detail.access.failedAttempts === 1 ? "attempt" : "attempts"}
              </li>
            ) : null}
          </ul>
          <AccessActions
            accountId={detail.account.id}
            accountName={displayName}
            chip={detail.access.chip}
          />
        </div>
      </Card>

      <Card title="Cafés & roles" sub="Memberships held by this account.">
        {detail.cafes.length === 0 ? (
          <p className="text-sm text-ink-600">No café yet — signed up but never started.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.cafes.map((cafe) => (
              <li key={cafe.id} className="text-sm">
                <Link
                  href={`/admin/cafes/${cafe.id}`}
                  className="font-medium text-accent-800 underline"
                >
                  {cafe.name}
                </Link>
                <span className="text-ink-500"> · {cafe.role}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Menus" sub="Drafts and live state — never the document body.">
        {detail.menus.length === 0 ? (
          <p className="text-sm text-ink-600">No menus yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.menus.map((menu) => (
              <li key={menu.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span>
                  {menu.title}
                  <span className="text-ink-500"> · {menu.live ? "live" : "draft"}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {shortDate(menu.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Extraction usage" sub="This month against the cap.">
        <p className="text-sm tabular-nums text-ink-900">
          {detail.usage.requests} of {detail.usage.cap} ({usagePct}%)
        </p>
        <p className="mt-1 text-xs tabular-nums text-ink-500">{detail.usage.remaining} remaining</p>
      </Card>

      <Card title="Orders" sub="Status and total only — no line items, no diner identities.">
        <p className="text-sm tabular-nums text-ink-900">
          {detail.orders.total} total · {detail.orders.last7} in the last 7 days
          {detail.orders.lastOrderAt ? ` · last ${shortDate(detail.orders.lastOrderAt)}` : ""}
        </p>
        {detail.orders.recent.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {detail.orders.recent.map((order) => (
              <li key={order.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span>
                  Table {order.tableLabel} · {order.status}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {shortDate(order.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Sessions" sub="Where this account is signed in — device only, never an address.">
        {detail.sessions.length === 0 ? (
          <p className="text-sm text-ink-600">No active sessions.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {detail.sessions.map((session) => (
              <li key={session.id} className="text-sm">
                <span className="block truncate text-ink-900">
                  {session.userAgent ?? "Unknown device"}
                </span>
                <span className="text-xs tabular-nums text-ink-500">
                  since {shortDate(session.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Timeline" sub="Account, café and audit milestones, newest first.">
        {detail.timeline.length === 0 ? (
          <p className="text-sm text-ink-600">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.timeline.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span>{entry.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {shortDate(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Operator log" sub="Recorded actions about this account.">
        {detail.events.length === 0 ? (
          <p className="text-sm text-ink-600">No operator actions recorded for this account.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.events.map((event) => (
              <li key={event.id} className="text-sm">
                <span className="font-medium">{event.action}</span>
                <span className="text-ink-600"> · {event.actorEmail ?? "the CLI"}</span>
                <span className="block text-xs tabular-nums text-ink-500">
                  {shortDate(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

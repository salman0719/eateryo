/**
 * Café detail (B3) — one café, read-only.
 *
 * Server-rendered per request behind the layout guard, straight from
 * `getCafeDetail`: the team with roles and suspension flags, menus with
 * live state, orders without line items. Unknown ids are the plain 404.
 * A suspended owner blocks sign-in and owner changes — diners are
 * unaffected, live menus keep serving table orders.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { getCafeDetail, PlatformRepoError } from "@/features/platform/repo";
import { getDb } from "@/lib/db";

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "—"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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

export default async function AdminCafeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await getCafeDetail(getDb(), id);
  } catch (error) {
    if (error instanceof PlatformRepoError && error.code === "not_found") notFound();
    throw error;
  }

  return (
    <section className="flex flex-col gap-6">
      <p>
        <Link href="/admin/cafes" className="text-sm font-medium text-accent-800 underline">
          All cafés
        </Link>
      </p>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{detail.cafe.name}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {detail.cafe.slug ? `/r/${detail.cafe.slug} · ` : ""}opened{" "}
          {shortDate(detail.cafe.createdAt)} · read-only
        </p>
      </div>

      {detail.ownerSuspended ? (
        <div className="rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3">
          <p className="text-sm font-semibold text-danger-900">
            The owner&apos;s account is suspended
          </p>
          <p className="mt-1 text-xs text-danger-800">
            Diners are unaffected: live menus keep serving table orders. Sign-in and owner changes
            are blocked.
          </p>
        </div>
      ) : null}

      <Card
        title="Team"
        sub="The owner is the only role that can publish, invite, or change café settings."
      >
        {detail.members.length === 0 ? (
          <p className="text-sm text-ink-600">No members — this café was left ownerless.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.members.map((member) => (
              <li key={member.userId} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0">
                  <Link
                    href={`/admin/accounts/${member.userId}`}
                    className="font-medium text-accent-800 underline"
                  >
                    {member.name.trim() ? member.name : member.email}
                  </Link>
                  <span className="block truncate text-xs text-ink-500">{member.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
                  {member.suspended ? (
                    <span className="rounded-full border border-line-200 px-2 py-0.5 font-semibold text-ink-900">
                      Suspended
                    </span>
                  ) : null}
                  {member.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Menus" sub="Only a live menu is offered at the table cards.">
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

      <Card title="Orders" sub="Table orders, priced from the published snapshot.">
        <p className="text-sm tabular-nums text-ink-900">
          {detail.orders.total} total · {detail.orders.last7} in the last 7 days
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
    </section>
  );
}

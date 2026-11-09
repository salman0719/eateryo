"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

/**
 * App header. Storage mode is deliberately not pitched here: signed-out
 * visitors see an ordinary Sign in action, and signed-in ones see the
 * account their menus belong to. The editor reports "Saved" and puts where
 * it went in the tooltip (R1 concept diet).
 */
export function SiteHeader() {
  const { data, isPending } = authClient.useSession();
  const user = data?.user ?? null;

  return (
    <header data-print-hide className="border-b border-line-200 bg-surface-base">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700 text-base font-bold text-on-accent"
          >
            E
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-ink-900">Eateryo</p>
            <p className="text-xs text-ink-500">Menus, tables, and orders in one place</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!isPending && !user && (
            <a
              href="/launch"
              className="hidden rounded-lg px-2 py-1 text-[11px] font-semibold text-warning-800 hover:bg-accent-50 hover:text-accent-900 sm:inline"
            >
              Get started
            </a>
          )}
          {isPending ? (
            <div role="status" aria-busy="true" className="flex items-center gap-3">
              <span className="sr-only">Checking your session…</span>
              <Skeleton className="hidden h-3 w-16 sm:inline" />
              <Skeleton className="h-7 w-16 rounded-lg" />
            </div>
          ) : user ? (
            <>
              {/* R0 phone identity: a compact avatar chip, since the email is desktop-only. */}
              <span
                aria-hidden="true"
                title={user.email}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-700 text-xs font-bold text-on-accent sm:hidden"
              >
                {(user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="hidden text-[11px] text-ink-500 sm:inline" title="Signed in as">
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => void authClient.signOut()}
                className="rounded-lg border border-line-300 px-2.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Sign out
              </button>
            </>
          ) : (
            <a
              href="/sign-in"
              className="rounded-lg border border-line-300 px-2.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-surface-50 hover:text-ink-900"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

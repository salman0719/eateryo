import Link from "next/link";
import { connection } from "next/server";

import { accountSuspendedMessage } from "@/lib/auth/account-state";

/**
 * Signed-out landing for suspended accounts: where `/verify` sends a magic
 * link that was refused over an open suspension, instead of the raw 403
 * JSON the verification endpoint answers.
 *
 * Rendered per request (via `connection()` — the `dynamic` segment config
 * is banned under `cacheComponents`) so the contact line tracks the
 * deployment's `CONTACT_EMAIL` rather than whatever the build machine had
 * set. The page never learns a reason — it only ever carries the generic
 * copy — and it never learns whose account it is, so there is nothing here
 * to leak.
 */

// The contact line is request-time data, so this page renders on demand
// instead of prerendering an instant shell (Next 16 cacheComponents).
export const instant = false;

export default async function SuspendedPage() {
  await connection();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          This account is suspended
        </h1>
        <p className="mt-2 text-sm text-ink-600">{accountSuspendedMessage()}</p>
      </div>

      <div className="rounded-xl border border-line-200 bg-surface-base p-4 text-sm text-ink-700">
        <p>
          You&apos;re signed out, and sign-in links stay unavailable until the suspension is lifted.
          Anything you made on this device while signed out is still here.
        </p>
      </div>

      <p className="flex gap-4 text-sm text-ink-500">
        <Link href="/" className="underline underline-offset-2 hover:text-ink-800">
          Back to home
        </Link>
        <Link href="/sign-in" className="underline underline-offset-2 hover:text-ink-800">
          Try signing in again
        </Link>
      </p>
    </main>
  );
}

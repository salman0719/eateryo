import Link from "next/link";
import { redirect } from "next/navigation";

import { SetupTwoFactorForm } from "@/components/auth/setup-two-factor-form";
import { isTwoFactorEnrolled } from "@/lib/auth/account-state";
import { getSessionUser } from "@/lib/auth/session";
import { safeCallbackURL } from "@/lib/auth/verify-link";
import { getDb } from "@/lib/db";

// `?next=` is per-request routing data: never prerender (Next 16
// cacheComponents), like every other guarded page.
export const instant = false;

/**
 * Forced second-factor setup (P6) — the admin layout sends operators
 * without a factor here before `/admin` loads. The session the
 * password (or link) minted is the proof; anonymous visits go back to
 * sign-in, and an already-enrolled account continues where it came
 * from. Screens outside `(app)` never import café shell state.
 */
export default async function FactorSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSessionUser().catch(() => null);
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const callbackURL = safeCallbackURL(Array.isArray(params.next) ? params.next[0] : params.next);

  let enrolled = false;
  try {
    enrolled = await isTwoFactorEnrolled(getDb(), session.id);
  } catch {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Set up two-factor authentication
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            The server is not available yet — keep working locally and try again later.
          </p>
        </div>
      </main>
    );
  }
  if (enrolled) redirect(callbackURL);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Set up two-factor authentication
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          Operator accounts need a second factor. It takes one scan and one code — you can&apos;t
          skip this while the account can reach every caf&eacute;&apos;s data.
        </p>
      </div>

      <SetupTwoFactorForm callbackURL={callbackURL} />

      <p className="text-sm text-ink-500">
        <Link href="/" className="underline underline-offset-2 hover:text-ink-800">
          Back to the editor
        </Link>
      </p>
    </main>
  );
}

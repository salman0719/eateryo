import { redirect } from "next/navigation";

import { FactorScreen } from "@/components/auth/factor-screen";
import { getSessionUser } from "@/lib/auth/session";
import { safeCallbackURL } from "@/lib/auth/verify-link";

// `?next=` is per-request routing data: never prerender (Next 16
// cacheComponents), like every other guarded page. No session is needed
// here — a challenge in flight has none by design.
export const instant = false;

/**
 * Second-factor challenge (P6) — the password door sends operators with
 * a factor here. A fully signed-in visit has no challenge to answer and
 * continues where it came from.
 */
export default async function FactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const callbackURL = safeCallbackURL(Array.isArray(params.next) ? params.next[0] : params.next);

  const session = await getSessionUser().catch(() => null);
  if (session) redirect(callbackURL);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Verify it&apos;s you</h1>
        <p className="mt-2 text-sm text-ink-600">
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>

      <FactorScreen callbackURL={callbackURL} />
    </main>
  );
}

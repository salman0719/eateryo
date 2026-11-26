import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { SetPasswordForm } from "@/components/auth/set-password-form";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { account } from "@/lib/db/schema";

/**
 * Password set/change screen (P2) — reached after a verified link, never
 * linked from sign-in until P3. The session is the proof: anonymous
 * visitors go back to sign-in, and the route refuses them too.
 */

// Session + credential reads are per request: never prerender (Next 16
// cacheComponents), like every other guarded page.
export const instant = false;

export default async function SetPasswordPage() {
  const session = await getSessionUser().catch(() => null);
  if (!session) redirect("/sign-in");

  let hasPassword = false;
  try {
    const rows = await getDb()
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, session.id), eq(account.providerId, "credential")))
      .limit(1);
    hasPassword = rows.length > 0;
  } catch {
    // A DB we cannot reach means the form cannot work either; the route
    // answers 503, so say so here instead of rendering a dead form.
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            {hasPassword ? "Change your password" : "Choose a password"}
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            The server is not available yet — keep working locally and try again later.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          {hasPassword ? "Change your password" : "Choose a password"}
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          {hasPassword
            ? "Changing it signs you out on your other devices."
            : "You're in with an emailed link. Set a password so next time is one step — or keep using links."}
        </p>
      </div>

      <SetPasswordForm email={session.email} hasPassword={hasPassword} />
    </main>
  );
}

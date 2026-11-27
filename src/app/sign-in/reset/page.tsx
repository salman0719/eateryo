import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { INVALID_RESET_TOKEN_COPY } from "@/app/api/password/reset/route";

// `?token=` is per-request routing data: never prerender (Next 16
// cacheComponents), like every other guarded page.
export const instant = false;

/**
 * Reset-password screen (P5) — spends the emailed link.
 *
 * The token arrives as `?token=` and is handed straight to the form,
 * which spends it with exactly one use; a missing token renders the
 * same dead-link copy the API answers, so the page never promises what
 * the link cannot do.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Choose a new password</h1>
        <p className="mt-2 text-sm text-ink-600">
          {token ? "Setting it signs you out on your other devices." : INVALID_RESET_TOKEN_COPY}
        </p>
      </div>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-ink-600">
          <Link
            href="/sign-in/forgot"
            className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
          >
            Request a new one
          </Link>{" "}
          and try again.
        </p>
      )}
    </main>
  );
}

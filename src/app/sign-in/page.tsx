import Link from "next/link";

import { SignInScreen } from "@/components/auth/sign-in-screen";
import { isDevSignInEnabled } from "@/lib/auth/dev-sign-in";
import { safeCallbackURL } from "@/lib/auth/verify-link";

// `?next=` is per-request routing data: never prerender (Next 16
// cacheComponents), like every other guarded page.
export const instant = false;

/**
 * Password + magic-link sign-in (P3) — the password door first, the emailed
 * link as the second door. No create-account form: a first visit still
 * starts with a link and a password is offered after verification, so
 * sign-in never mints an account. Diners never see this page — ordering at
 * a table stays anonymous.
 *
 * `?next=` carries the operator redirect (`/sign-in?next=/admin`): both
 * doors return there after success, same-origin-guarded. With
 * `DEV_SIGN_IN_BYPASS=1` locally, the link door offers the parked link on
 * the page instead of emailing it; production never shows that panel.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const devSignIn = isDevSignInEnabled();
  const params = await searchParams;
  const callbackURL = safeCallbackURL(Array.isArray(params.next) ? params.next[0] : params.next);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sign in</h1>
        <p className="mt-2 text-sm text-ink-600">
          Use the email and password for your Eateryo account.
        </p>
      </div>

      <SignInScreen callbackURL={callbackURL} devSignIn={devSignIn} />

      <p className="text-sm text-ink-500">
        <Link href="/" className="underline underline-offset-2 hover:text-ink-800">
          Back to the editor
        </Link>{" "}
        — working signed out keeps everything local, as before.
      </p>
    </main>
  );
}

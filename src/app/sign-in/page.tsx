import Link from "next/link";

import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { isDevSignInEnabled } from "@/lib/auth/dev-sign-in";

/**
 * Magic-link sign-in (the only human sign-in — PHASE-2.md §3.6): one field,
 * one one-time link. Sign-up happens implicitly when a new email first uses
 * a link. Diners never see this page — ordering at a table stays anonymous.
 *
 * With `DEV_SIGN_IN_BYPASS=1` locally, the form offers the link on the page
 * instead of emailing it; production never shows that panel. The flag is read
 * here on the server, and `isDevSignInEnabled()` answers false in a production
 * build whatever the build machine had set.
 */
export default function SignInPage() {
  const devSignIn = isDevSignInEnabled();

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sign in</h1>
        <p className="mt-2 text-sm text-ink-600">
          Enter your email and we&apos;ll send a one-time sign-in link — no passwords to remember.
          The link expires in 5 minutes.
        </p>
      </div>

      <MagicLinkForm callbackURL="/" devSignIn={devSignIn} />

      <p className="text-sm text-ink-500">
        <Link href="/" className="underline underline-offset-2 hover:text-ink-800">
          Back to the editor
        </Link>{" "}
        — working signed out keeps everything local, as before.
      </p>
    </main>
  );
}

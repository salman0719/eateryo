import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

/**
 * Forgot-password screen (P5) — self-serve reset request.
 *
 * Static content: no session, no per-request data, so it prerenders.
 * The form always answers the same sent sentence, whatever the address
 * named, so the page never oracles which accounts exist (plan Q1).
 */
export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Reset your password</h1>
        <p className="mt-2 text-sm text-ink-600">
          Enter your email and we will send a link to set a new password. The link works once and
          expires in 30 minutes.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-sm text-ink-500">
        <Link href="/" className="underline underline-offset-2 hover:text-ink-800">
          Back to the editor
        </Link>{" "}
        — working signed out keeps everything local, as before.
      </p>
    </main>
  );
}

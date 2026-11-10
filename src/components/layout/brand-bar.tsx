import { BrandLockup } from "@/components/ui/brand";

/**
 * The brand surface on a phone.
 *
 * Below `sm` the app has no sidebar, so this row is the only place the name
 * appears — and, signed out, the only way into `/sign-in`: the sidebar's
 * account block is desktop-only and the More sheet is signed-in only, so a
 * visitor with no drafts was left with no sign-in path at all.
 *
 * The row takes no device decision of its own. The caller owns the width, so
 * the signed-out home can later mount the same lockup in a roomier desktop
 * composition instead of growing a second copy.
 *
 * While the session is unanswered the lockup stands alone: a read that has not
 * settled is never rendered as signed out (issues 003, 015, 016), and a Sign in
 * link that appears and then vanishes would be exactly that claim.
 */
export function BrandBar({
  signedIn,
  sessionPending,
  className = "",
}: {
  signedIn: boolean;
  sessionPending: boolean;
  /** The caller's width rule — the phone mount passes `sm:hidden`. */
  className?: string;
}) {
  return (
    <div
      data-print-hide
      className={`flex items-center justify-between gap-3 px-4 pt-4 ${className}`}
    >
      <BrandLockup />
      {!sessionPending && !signedIn ? (
        <a
          href="/sign-in"
          className="shrink-0 rounded-lg border border-line-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          Sign in
        </a>
      ) : null}
    </div>
  );
}

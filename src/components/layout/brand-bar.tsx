import { BrandLockup } from "@/components/ui/brand";

/**
 * The brand surface on a phone.
 *
 * Below `sm` the app has no sidebar, so this row is the only place the name
 * appears — and, signed out, the only way into `/sign-in`: the sidebar never
 * shows without an account and the More sheet is signed-in only, so a visitor
 * would otherwise have no sign-in path at all. It carries nothing else: a
 * signed-out visitor has no destinations to browse.
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
  onHome,
  onSignIn,
}: {
  signedIn: boolean;
  sessionPending: boolean;
  /** The caller's width rule — `sm:hidden` while the sidebar carries the brand. */
  className?: string;
  /** The lockup's destination; inside the shell it is client-side Capture. */
  onHome?: () => void;
  /**
   * Signed-out sign-in path. When the shell hands this over, the button asks
   * about the browser draft first instead of navigating straight away.
   */
  onSignIn?: () => void;
}) {
  return (
    <div data-print-hide className={className}>
      {/* The same measure as the column's `main`, so the name lines up with the
          page whether or not the sidebar is beside it. */}
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <BrandLockup onSelect={onHome ?? null} />
        {!sessionPending && !signedIn ? (
          <div className="flex shrink-0 items-center gap-2">
            {onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="rounded-lg border border-line-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Sign in
              </button>
            ) : (
              <a
                href="/sign-in"
                className="rounded-lg border border-line-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Sign in
              </a>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

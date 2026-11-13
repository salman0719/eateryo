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
  onHome,
  onLibrary,
}: {
  signedIn: boolean;
  sessionPending: boolean;
  /** The caller's width rule — `sm:hidden` while the sidebar carries the brand. */
  className?: string;
  /** The lockup's destination; inside the shell it is client-side Capture. */
  onHome?: () => void;
  /**
   * Signed-out library path. The sidebar never shows without an account, so
   * the row carries My menus itself while this browser holds a draft.
   */
  onLibrary?: () => void;
}) {
  return (
    <div data-print-hide className={className}>
      {/* The same measure as the column's `main`, so the name lines up with the
          page whether or not the sidebar is beside it. */}
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <BrandLockup onSelect={onHome ?? null} />
        {!sessionPending && !signedIn ? (
          <div className="flex shrink-0 items-center gap-2">
            {onLibrary ? (
              <button
                type="button"
                onClick={onLibrary}
                className="rounded-lg border border-line-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                My menus
              </button>
            ) : null}
            <a
              href="/sign-in"
              className="rounded-lg border border-line-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-surface-50 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              Sign in
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

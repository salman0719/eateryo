import Link from "next/link";

/**
 * Footer for content and app pages. Legal navigation only — the "Get
 * started" invitation lives in the content header, never here.
 * Plain links, no client JS.
 */
export function SiteFooter() {
  return (
    <footer
      data-print-hide
      className="mt-12 border-t border-line-200 bg-surface-base/60 sm:h-[var(--app-bottom-bar-height)]"
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-ink-500 sm:py-0">
        <p>Eateryo — free while it lasts. No payment step anywhere.</p>
        <nav aria-label="Legal" className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-ink-800">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink-800">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}

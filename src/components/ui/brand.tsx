/**
 * The brand lockup, in one place.
 *
 * The tile carrying an "E" and the word "Eateryo" were drawn separately in the
 * sidebar and in the content header, and the phone's brand bar would have been
 * a third copy. One component means a change to the mark or the name cannot
 * land in some surfaces and miss the others.
 *
 * Every colour here is a role token, so a palette change re-colours the brand
 * without touching a component. The chosen identity (concept 7, "The Hidden
 * Eat", which splits the name into `eat` and `eryo`) is deliberately not
 * applied yet: the theme moves first, and then the drawn lockup replaces the
 * text below — in this file only.
 */
export function BrandLockup({
  tagline = null,
  truncate = false,
  labelClassName = "",
  className = "",
}: {
  /** The second line. Omit it for the mark and the name alone. */
  tagline?: string | null;
  /** Clip the two lines instead of letting them set the lockup's width. */
  truncate?: boolean;
  /**
   * Classes on the text block. The sidebar passes `app-sidebar-label`, the
   * rule that hides the name once the column is a 72px rail.
   */
  labelClassName?: string;
  className?: string;
}) {
  const line = truncate ? "block truncate" : "block";
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-700 text-base font-bold text-on-accent"
      >
        E
      </span>
      <span className={`min-w-0 ${labelClassName}`}>
        <span className={`${line} text-sm font-bold tracking-tight text-ink-900`}>Eateryo</span>
        {tagline ? <span className={`${line} text-xs text-ink-500`}>{tagline}</span> : null}
      </span>
    </div>
  );
}

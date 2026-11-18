import { BrandLockup } from "@/components/ui/brand";

/**
 * The wait a returning account sees while its first reads settle — the
 * session, the café it acts in, and the library — so the signed-in shell is
 * revealed once, already complete, instead of assembling itself under the
 * cursor (logo at the top, then a column, then a different left offset).
 *
 * `ShellFrame` renders it over the frame, never instead of it: the reads that
 * end the wait belong to the providers above, and unmounting the shell would
 * restart them. So the frame keeps running underneath and is simply covered.
 *
 * Visibility is CSS, from `data-session` on `<html>` (`globals.css`), which
 * the boot script in `layout.tsx` sets before the first paint. That is the
 * whole point: only a browser that may hold a session sees this, and it sees
 * it from the first painted pixel, with no hydration race to lose. React only
 * decides when it is gone — see `sessionLoaderCovers` for the two failed reads
 * it hands back to the shell.
 */
export function SessionLoader() {
  return (
    <div className="session-loader fixed inset-0 z-50 items-center justify-center bg-surface-base">
      <div role="status" aria-busy="true" className="flex flex-col items-center gap-6">
        <BrandLockup />
        {/* Motion is the only signal this is a wait rather than a blank page;
            the dots are decoration, so a screen reader gets the sentence. */}
        <span aria-hidden="true" className="flex items-end gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="session-loader-dot h-1.5 w-1.5 rounded-full bg-accent-700"
              style={{ animationDelay: `${dot * 160}ms` }}
            />
          ))}
        </span>
        <span className="sr-only">Loading your account…</span>
      </div>
    </div>
  );
}

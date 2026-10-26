"use client";

import { MISSING_PUBLISH_DRAFT_MESSAGE } from "@/features/navigation/routes";

/**
 * A publish URL opened where its draft doesn't exist — almost always the
 * sign-in link opened in a different browser than the one holding the
 * draft. Holds the URL (no bounce to the library) and names the fix: the
 * draft is still waiting in the original browser.
 */
export function MissingDraftCard({
  onOpenLibrary,
  onStartFresh,
}: {
  /** Carry on with this browser's own menus. */
  onOpenLibrary: () => void;
  /** Start over with a new capture in this browser. */
  onStartFresh: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
          Link opened in the wrong place
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
          Your draft isn&apos;t in this browser.
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">{MISSING_PUBLISH_DRAFT_MESSAGE}</p>
      </div>

      <ol className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5">
        <li className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-[11px] font-bold text-amber-800"
          >
            1
          </span>
          <p className="text-sm leading-6 text-stone-700">
            Go back to the browser where you photographed the menu — your draft is still there,
            exactly as you left it.
          </p>
        </li>
        <li className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-[11px] font-bold text-amber-800"
          >
            2
          </span>
          <p className="text-sm leading-6 text-stone-700">
            Open the sign-in email there and tap the link. Your draft and the link step will be
            waiting.
          </p>
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenLibrary}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Go to My menus
        </button>
        <button
          type="button"
          onClick={onStartFresh}
          className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Start a new menu
        </button>
      </div>
    </div>
  );
}

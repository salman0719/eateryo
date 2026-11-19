"use client";

import { useEffect, useRef } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";

import { Attention } from "@/components/ui/attention";
import { JourneySteps } from "@/components/ui/journey-steps";
import { CaptureStepRail, type CaptureStop } from "@/components/upload/capture-step-rail";
import { Dropzone } from "@/components/upload/dropzone";
import { ExtractionProgress } from "@/components/upload/extraction-progress";
import { ExtractionResult, type PreviewMenu } from "@/components/upload/extraction-result";
import { ImagePreview, type PageImage } from "@/components/upload/image-preview";
import type { MenuDocument } from "@/features/menu/schema";
import type { ExtractClientError } from "@/lib/extract-client";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

/** The capture flow's phase, shared with the shell that owns the extraction. */
export type CapturePhase = "upload" | "ready" | "extracting" | "done";

/**
 * Capture's three stops. Publish is the wizard, mounted here as the last stop
 * so pressing Publish does not leave the screen; its own URL still exists for
 * the magic link that brings a signed-out owner back.
 */
export type CaptureView = "capture" | "review" | "publish";

type ResultProps = ComponentProps<typeof ExtractionResult>;

/**
 * What a first-time visitor is promised, and only what the app actually does.
 * No accuracy claim: extraction can be wrong, which is why review is a stop in
 * the tracker below rather than a footnote.
 */
const ENTRY_POINTS = [
  "Every dish, typed out — AI reads the photo, and anything it is unsure of is flagged for you to check.",
  "Publish to a QR code at each table — diners scan, order from the live menu, and install nothing.",
  "Your draft stays in this browser — nothing leaves this device until you publish it.",
];

export interface CapturePageProps {
  signedIn: boolean;
  /** Session still resolving: never claim "publishing needs an account" yet. */
  sessionPending: boolean;
  /**
   * Which stop is showing. Capture renders *only* this one, so the step you
   * are on never shares the screen with the work of another.
   */
  view: CaptureView;
  onViewChange: (view: CaptureView) => void;
  /**
   * The publish stop, mounted by the shell once the draft is saved. Null means
   * there is nothing to publish yet, so the stop cannot be opened.
   */
  publishSlot?: ReactNode;
  phase: CapturePhase;
  pages: PageImage[];
  fileError: string | null;
  /** Hidden pickers the page opens for add/replace; owned by the shell. */
  addInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  replaceIndexRef: RefObject<number | null>;
  resultRef: RefObject<HTMLDivElement | null>;
  onSelectFiles: ComponentProps<typeof Dropzone>["onSelect"];
  onDemo: () => void;
  onAddPages: (files: File[]) => void;
  onReplacePageAt: (index: number, file: File) => void;
  onRemovePage: (index: number) => void;
  onExtract: () => void;
  extractProgress: {
    pageCount: number;
    preparedPages: number;
    requestStartedAt: number | null;
  } | null;
  extractError: ExtractClientError | null;
  result: PreviewMenu | null;
  previewDoc: MenuDocument | null;
  source: "ai" | "demo";
  draftSave: "idle" | "saving" | "saved" | "unavailable";
  /** True when the autosaved draft already lives on the account (signed-in server-first). */
  draftOnServer?: boolean;
  initialReviewCount: number | null;
  onClear: () => void;
  onEdit: () => void;
  onResolveItem: ResultProps["onResolveItem"];
  onResolveAll: ResultProps["onResolveAll"];
  onUpdatePrice: ResultProps["onUpdatePrice"];
  onRenameTitle: ResultProps["onRenameTitle"];
  onPublish: (() => void) | undefined;
}

function FileErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
    >
      {message}
    </p>
  );
}

/**
 * Capture: photo in, extraction progress, review out — one stop at a time.
 *
 * The page owns no data; the shell keeps the pages, the extraction and the
 * saved draft. What it does own is which stop is on screen: the work view
 * (photo + extraction, merged into the first stop) or the review. Only one is
 * rendered, so the upload field is never stacked above a review list and the
 * extraction's progress appears under the pages it is reading.
 *
 * The first stop keeps three honest states — nothing read, reading, read —
 * and only "nothing read" can start a read. A return visit shows what the
 * extraction produced and how to continue; re-reading is one explicit action
 * that says it replaces the draft.
 *
 * Signed out on an empty page it also has to be the front door: nobody has a
 * sidebar destination to click, so the photo field carries the product's one
 * promise and the three things it actually delivers. That composition is
 * limited to the empty upload state; the moment a photo is chosen the screen
 * returns to the plain working layout, and a signed-in owner never sees it.
 */
export function CapturePage({
  signedIn,
  sessionPending,
  view,
  onViewChange,
  publishSlot = null,
  phase,
  pages,
  fileError,
  addInputRef,
  replaceInputRef,
  replaceIndexRef,
  resultRef,
  onSelectFiles,
  onDemo,
  onAddPages,
  onReplacePageAt,
  onRemovePage,
  onExtract,
  extractProgress,
  extractError,
  result,
  previewDoc,
  source,
  draftSave,
  draftOnServer = false,
  initialReviewCount,
  onClear,
  onEdit,
  onResolveItem,
  onResolveAll,
  onUpdatePrice,
  onRenameTitle,
  onPublish,
}: CapturePageProps) {
  /**
   * The entry composition: nobody known to be signed in, and nothing uploaded
   * yet. `sessionPending` is excluded so a signed-in owner's cold load cannot
   * flash the visitor's page before their own screen appears.
   */
  const entering = !signedIn && !sessionPending && phase === "upload" && pages.length === 0;

  /** Publish is only a screen once the shell has mounted its wizard. */
  const publishOpen = view === "publish" && publishSlot !== null;
  /** Review is only a screen once there is something to review. */
  const reviewOpen = !publishOpen && view === "review" && result !== null;
  const extracting = phase === "extracting";

  const dishCount =
    result?.categories.reduce((sum, category) => sum + category.items.length, 0) ?? 0;
  const categoryCount = result?.categories.length ?? 0;

  /**
   * The first line of the stop on screen: the review's "Check what the AI
   * read" heading, or the wizard's own opening block ("Final step" signed
   * out). A stop change scrolls to this, not to the page top, so the reader
   * lands on the heading they came for.
   */
  const stopTopRef = useRef<HTMLDivElement | null>(null);

  const currentStop: CaptureStop = publishOpen ? "publish" : reviewOpen ? "review" : "capture";
  const reachable = new Set<CaptureStop>(["capture"]);
  if (result !== null) reachable.add("review");
  if (onPublish || publishSlot !== null) reachable.add("publish");

  const savedNotice =
    source === "ai" && draftSave === "saved"
      ? draftOnServer
        ? "Draft saved to your account"
        : "Draft saved in this browser"
      : source === "ai" && draftSave === "saving"
        ? "Saving draft…"
        : null;

  /**
   * Entering Review or Publish scrolls to the stop's own first line: Review to
   * "Check what the AI read", Publish to the wizard's opening block. The three
   * stops share one address, so nothing else resets the scroll — before this,
   * Publish opened at the review's offset (clamped to the shorter wizard, mid
   * form) and Review came back with its heading above the viewport.
   *
   * Nothing else scrolls the page on a stop change now that the rail centres
   * its own strip, so one smooth scroll is the whole fix. A document that is
   * not visible never animates one, which is what a background tab would show
   * on return, so that case jumps instead. Going back to the photos is not a
   * move forward in the journey, so it does not scroll.
   */
  useEffect(() => {
    if (view === "capture" || typeof window === "undefined") return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduce || document.hidden ? "auto" : "smooth";
    const top = stopTopRef.current;
    if (top) top.scrollIntoView({ block: "start", behavior });
    else window.scrollTo({ top: 0, behavior });
  }, [view]);

  function selectStop(stop: CaptureStop) {
    if (stop === currentStop) return;
    // The shell saves the draft before it can mount the wizard, so an unopened
    // Publish stop is an action, not a view change.
    if (stop === "publish" && publishSlot === null) {
      onPublish?.();
      return;
    }
    onViewChange(stop);
  }

  return (
    <>
      {entering ? (
        /**
         * One column on a phone — headline, the three stops, the photo field,
         * then the promises — so the only action is never pushed below the
         * fold. Two columns from `lg`, where the field gets a column of its
         * own; the stepper then owns the left column at its full width, since
         * that column is the reading column it belongs to.
         *
         * The left column is `display: contents` on a phone so its three parts
         * order themselves around the photo field, and becomes a real column
         * from `lg`. `order` keeps that phone reading order: the stops come
         * before the field, the promises after it.
         */
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-start lg:gap-x-12">
          <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-8">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-accent-700 uppercase">
                Photo in, orders out
              </p>
              <h1 className="mt-2 max-w-xl text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
                Turn a menu photo into a table-ordering page
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-ink-600 sm:text-base">
                Upload the photo you already have. AI types out the categories, dishes and prices,
                you correct anything it read wrong, and publishing puts a QR code on every table.
              </p>
            </div>

            {/* The reading column's width, from the first stop to the last. */}
            <JourneySteps current={0} />

            <div className="order-2 lg:order-none">
              <ul className="flex max-w-xl flex-col gap-3">
                {ENTRY_POINTS.map((point) => (
                  <li key={point} className="flex gap-3 text-sm leading-6 text-ink-700">
                    <span
                      aria-hidden="true"
                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-700"
                    />
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-5 max-w-xl text-xs leading-5 text-ink-500">
                Free while it lasts — no card, no payment step. Publishing needs a sign-in link sent
                to your email, and until you publish your draft stays in this browser.
              </p>
            </div>
          </div>

          <div className="order-1 flex flex-col gap-3 lg:order-none lg:col-start-2 lg:row-start-1">
            <Dropzone onSelect={onSelectFiles} />
            {fileError && <FileErrorNotice message={fileError} />}
            <p className="text-center text-sm text-ink-500">
              No menu handy?{" "}
              <button
                type="button"
                onClick={onDemo}
                className="font-medium text-accent-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                Preview with demo data
              </button>
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* The rail leads: it is the same three stops on every one of them. */}
          <CaptureStepRail current={currentStop} reachable={reachable} onSelect={selectStop} />
          {publishOpen ? (
            <div ref={stopTopRef} className="scroll-mt-4">
              {publishSlot}
            </div>
          ) : (
            <div ref={stopTopRef} className="scroll-mt-4">
              <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
                {reviewOpen ? "Check what the AI read" : "Turn your photo into a menu"}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink-600 sm:text-base">
                {reviewOpen
                  ? "Fix anything the read got wrong — prices, names, descriptions. Nothing is published until you say so."
                  : "Upload a photo or scan, and the read happens on this screen. Then you check it, correct it, and publish."}
              </p>
              {!signedIn && !sessionPending && !reviewOpen && (
                <p className="mt-1.5 max-w-xl text-xs leading-5 text-ink-500">
                  You can upload and review first. Publishing needs an account — we’ll email you a
                  sign-in link, and your draft stays in this browser.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ------------------------------- stop 1 ------------------------------- */}
      {!entering && !reviewOpen && !publishOpen && (
        <>
          {pages.length === 0 && phase === "upload" && result === null && (
            <div className="flex flex-col gap-3">
              <Dropzone onSelect={onSelectFiles} />
              {fileError && <FileErrorNotice message={fileError} />}
              <p className="text-center text-sm text-ink-500">
                No menu handy?{" "}
                <button
                  type="button"
                  onClick={onDemo}
                  className="font-medium text-accent-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Preview with demo data
                </button>
              </p>
            </div>
          )}

          {pages.length > 0 && (
            <div className="flex flex-col gap-3">
              <ImagePreview
                pages={pages}
                onAdd={() => addInputRef.current?.click()}
                onReplace={(index) => {
                  replaceIndexRef.current = index;
                  replaceInputRef.current?.click();
                }}
                onRemove={onRemovePage}
              />
              <input
                ref={addInputRef}
                type="file"
                multiple
                accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  const added = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (added.length > 0) onAddPages(added);
                }}
              />
              <input
                ref={replaceInputRef}
                type="file"
                accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  const index = replaceIndexRef.current;
                  event.target.value = "";
                  replaceIndexRef.current = null;
                  if (next && index !== null) onReplacePageAt(index, next);
                }}
              />
            </div>
          )}

          {fileError && pages.length > 0 && <FileErrorNotice message={fileError} />}

          {/* A return visit: the read that produced the draft, not a fresh call. */}
          {result !== null && !extracting && (
            <section
              aria-label="What this read produced"
              className="rounded-2xl border border-line-200 bg-surface-base p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">
                  {source === "demo" ? "Sample menu" : "Read"} {dishCount}{" "}
                  {dishCount === 1 ? "dish" : "dishes"} in {categoryCount}{" "}
                  {categoryCount === 1 ? "category" : "categories"}
                </p>
                <span className="rounded-full border border-accent-300 bg-accent-100 px-2 py-0.5 text-[11px] font-semibold text-accent-800">
                  {source === "demo" ? "Demo data" : "Extracted"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-ink-600">
                {source === "demo"
                  ? "This is demo data, labelled as such — no AI read ran. Upload a photo to replace it with a real draft."
                  : "This is the read behind your draft. Coming back to this stop does not start another one — extracting again replaces the draft and spends another AI call."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={() => onViewChange("review")}
                  className="rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Continue to review →
                </button>
                {/* The same start over the review offers: this stop is where a
                    return visit lands, so it needs the way out too. */}
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-full border border-line-300 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  Start over
                </button>
                {savedNotice && <span className="text-xs text-ink-500">{savedNotice}</span>}
              </div>
            </section>
          )}

          {pages.length > 0 && (
            <div>
              <button
                type="button"
                onClick={onExtract}
                disabled={extracting}
                className={
                  result === null
                    ? "w-full rounded-full bg-accent-700 px-6 py-3 text-base font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 sm:w-auto"
                    : "rounded-full border border-line-300 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-accent-700 hover:text-accent-900 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                }
              >
                {extracting
                  ? "Extracting… this can take up to a minute"
                  : result === null
                    ? "Extract menu"
                    : "Extract again"}
              </button>
              <p className="mt-2 text-xs text-ink-500">
                {result === null
                  ? "Calls the AI once, only when you press this. Accuracy depends on image quality."
                  : "Replaces the current draft and its review edits. Asks before it runs."}
              </p>
            </div>
          )}

          <Attention active={extracting} pulse={false} scrollBlock="start" className="scroll-mt-4">
            {extracting && extractProgress && (
              <ExtractionProgress
                pageCount={extractProgress.pageCount}
                preparedPages={extractProgress.preparedPages}
                requestStartedAt={extractProgress.requestStartedAt}
                signedIn={signedIn}
              />
            )}
          </Attention>

          {extractError && !extracting && (
            <div
              role="alert"
              className="rounded-2xl border border-danger-200 bg-danger-50 px-5 py-4"
            >
              <p className="font-medium text-danger-900">Extraction failed</p>
              <p className="mt-1 text-sm text-danger-800">{extractError.message}</p>
              {extractError.code === "missing_api_key" && (
                <button
                  type="button"
                  onClick={onDemo}
                  className="mt-3 rounded-full bg-danger-800 px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-danger-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700"
                >
                  Preview with demo data instead
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ------------------------------- stop 2 ------------------------------- */}
      {reviewOpen && result && (
        <div ref={resultRef}>
          <ExtractionResult
            data={result}
            source={source}
            onStartOver={onClear}
            // Onboarding ends at Publish: signed out there is no editor
            // route at all, so the second path would only dead-end.
            onEdit={signedIn ? onEdit : undefined}
            reassureEditable={!signedIn}
            onResolveItem={onResolveItem}
            onResolveAll={onResolveAll}
            onUpdatePrice={onUpdatePrice}
            onRenameTitle={onRenameTitle}
            initialReviewCount={initialReviewCount}
            onPublish={onPublish}
            previewDoc={previewDoc}
            savedNotice={savedNotice}
            editLabel={
              source === "ai"
                ? draftSave === "saved"
                  ? "Open in editor"
                  : "Edit menu"
                : "Save & open editor"
            }
          />
        </div>
      )}
    </>
  );
}

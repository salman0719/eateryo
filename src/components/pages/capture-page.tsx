"use client";

import type { ComponentProps, RefObject } from "react";

import { Attention } from "@/components/ui/attention";
import { JourneySteps } from "@/components/ui/journey-steps";
import { Dropzone } from "@/components/upload/dropzone";
import { ExtractionProgress } from "@/components/upload/extraction-progress";
import { ExtractionResult, type PreviewMenu } from "@/components/upload/extraction-result";
import { ImagePreview, type PageImage } from "@/components/upload/image-preview";
import type { MenuDocument } from "@/features/menu/schema";
import type { ExtractClientError } from "@/lib/extract-client";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

/** The capture flow's phase, shared with the shell that owns the extraction. */
export type CapturePhase = "upload" | "ready" | "extracting" | "done";

type ResultProps = ComponentProps<typeof ExtractionResult>;

export interface CapturePageProps {
  signedIn: boolean;
  /** Session still resolving: never claim "publishing needs an account" yet. */
  sessionPending: boolean;
  /** Which onboarding stop the tracker marks (0 upload, 1 extract, 2 review). */
  step: number;
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
  initialReviewCount: number | null;
  onClear: () => void;
  onEdit: () => void;
  onResolveItem: ResultProps["onResolveItem"];
  onResolveAll: ResultProps["onResolveAll"];
  onUpdatePrice: ResultProps["onUpdatePrice"];
  onRenameTitle: ResultProps["onRenameTitle"];
  onPublish: (() => void) | undefined;
}

/**
 * Capture: photo in, extraction progress, review out. It owns no data — the
 * shell keeps the pages, the extraction and the saved draft — so a retry or a
 * navigation does not reset the flow.
 */
export function CapturePage({
  signedIn,
  sessionPending,
  step,
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
  initialReviewCount,
  onClear,
  onEdit,
  onResolveItem,
  onResolveAll,
  onUpdatePrice,
  onRenameTitle,
  onPublish,
}: CapturePageProps) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          Turn your photo into a menu
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink-600 sm:text-base">
          Upload a photo or scan of a menu, extract it into categories and items with AI, then review
          and correct the draft. AI output is never guaranteed — you stay in charge.
        </p>
        {!signedIn && !sessionPending && (
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-ink-500">
            You can upload and review first. Publishing needs an account — we’ll email you a sign-in
            link, and your draft stays in this browser.
          </p>
        )}
      </div>

      <JourneySteps current={step} />

      {phase === "upload" && pages.length === 0 && (
        <div className="flex flex-col gap-3">
          <Dropzone onSelect={onSelectFiles} />
          {fileError && (
            <p
              role="alert"
              className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
            >
              {fileError}
            </p>
          )}
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
        <div className="flex flex-col gap-4">
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
          {fileError && (
            <p
              role="alert"
              className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
            >
              {fileError}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={onExtract}
              disabled={phase === "extracting"}
              className="w-full rounded-full bg-accent-700 px-6 py-3 text-base font-semibold text-on-accent transition-colors hover:bg-accent-800 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 sm:w-auto"
            >
              {phase === "extracting" ? "Extracting… this can take up to a minute" : "Extract menu"}
            </button>
            <p className="mt-2 text-xs text-ink-500">
              Calls the AI once, only when you press this. Accuracy depends on image quality.
            </p>
          </div>
        </div>
      )}

      <Attention
        active={phase === "extracting"}
        pulse={false}
        scrollBlock="start"
        className="scroll-mt-4"
      >
        {phase === "extracting" && extractProgress && (
          <ExtractionProgress
            pageCount={extractProgress.pageCount}
            preparedPages={extractProgress.preparedPages}
            requestStartedAt={extractProgress.requestStartedAt}
          />
        )}
      </Attention>

      {extractError && phase !== "extracting" && (
        <div role="alert" className="rounded-2xl border border-danger-200 bg-danger-50 px-5 py-4">
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

      {result && (
        <div ref={resultRef}>
          <ExtractionResult
            data={result}
            source={source}
            onStartOver={onClear}
            onEdit={onEdit}
            onResolveItem={onResolveItem}
            onResolveAll={onResolveAll}
            onUpdatePrice={onUpdatePrice}
            onRenameTitle={onRenameTitle}
            initialReviewCount={initialReviewCount}
            onPublish={onPublish}
            previewDoc={previewDoc}
            savedNotice={
              source === "ai" && draftSave === "saved"
                ? "Draft saved to My menus"
                : source === "ai" && draftSave === "saving"
                  ? "Saving draft…"
                  : null
            }
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

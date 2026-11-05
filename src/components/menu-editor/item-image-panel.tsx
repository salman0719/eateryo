"use client";

import { useRef, useState } from "react";

import type { MenuItem, MenuItemImage } from "@/features/menu/schema";
import { itemImageCopy } from "@/features/item-images/ref";
import { ItemImageError } from "@/features/item-images/errors";
import { uploadItemImage } from "@/features/item-images/upload";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

/**
 * The dish photo control on one item row: attach, replace, remove.
 *
 * Uploading is the only slow thing in this editor, so the row keeps working
 * while it runs: the controls show progress and lock themselves, and the
 * finished reference is handed to the editor's *current* document (never a
 * document captured before the upload started), so an edit made in the
 * meantime is not discarded.
 *
 * Removal clears the reference only. The stored file is kept on purpose — a
 * published revision may still be serving that photo to diners until the
 * owner republishes.
 */

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/** The label wraps the real file input, so focus lands on the input: ring it there. */
const fileLabel =
  `${smallButton} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 ` +
  "focus-within:outline-accent-700";

type UploadState =
  | { status: "idle" }
  | { status: "working"; percent: number }
  | { status: "error"; message: string };

export function ItemImagePanel({
  item,
  canUpload,
  onAttach,
}: {
  item: MenuItem;
  /** Signed in: the upload endpoint authorizes on the session. */
  canUpload: boolean;
  onAttach: (image: MenuItemImage | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const copy = itemImageCopy(item.image);
  const working = state.status === "working";

  async function handleFile(file: File) {
    setState({ status: "working", percent: 0 });
    try {
      const image = await uploadItemImage(file, {
        onProgress: (percent) => setState({ status: "working", percent }),
      });
      onAttach(image);
      setState({ status: "idle" });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ItemImageError
            ? error.message
            : "The photo could not be uploaded. Try again.",
      });
    }
  }

  return (
    <div className="rounded-lg border border-line-200 bg-surface-base p-2.5">
      <div className="flex items-center gap-3">
        {copy ? (
          // Straight from the CDN at the size we stored — no optimizer runs
          // for the editor either.
          <img
            src={copy.url}
            alt=""
            width={copy.width}
            height={copy.height}
            loading="lazy"
            decoding="async"
            className="h-12 w-12 shrink-0 rounded-md border border-line-200 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-line-300 bg-surface-50 text-lg text-ink-400"
          >
            ▢
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-ink-600 uppercase">Dish photo</p>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-500">
            {copy
              ? "Shown beside this dish on the order page."
              : canUpload
                ? "Optional. Diners see it beside the dish."
                : "Sign in to add a photo to this dish."}
          </p>
        </div>

        {canUpload && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <label className={`${fileLabel} ${working ? "pointer-events-none opacity-60" : ""}`}>
              {working ? "Uploading…" : copy ? "Replace" : "Add photo"}
              <input
                ref={inputRef}
                type="file"
                accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                aria-label={`Dish photo for ${item.name}`}
                className="sr-only"
                disabled={working}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset so picking the same file again still fires a change.
                  event.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {copy && (
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  setState({ status: "idle" });
                  onAttach(null);
                }}
                className={smallButton}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      {working && (
        <p role="status" className="mt-2 text-xs text-ink-500">
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-line-400 border-t-transparent align-[-2px]"
          />
          Uploading photo… {state.percent}%
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-xs text-danger-700">
          {state.message}
        </p>
      )}
    </div>
  );
}

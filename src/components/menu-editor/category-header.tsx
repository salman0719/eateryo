"use client";

import { useState } from "react";

import {
  isCategoryNameTaken,
  renameCategory,
  setCategoryCover,
  setCategoryDescription,
} from "@/features/menu/menu-utils";
import type { MenuCategory, MenuDocument, MenuItemImage } from "@/features/menu/schema";
import { ItemImageError } from "@/features/item-images/errors";
import { itemImageCopy } from "@/features/item-images/ref";
import { uploadItemImage } from "@/features/item-images/upload";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

import { ImageIcon } from "@/components/ui/icons";

import { CommitInput } from "./fields";

/**
 * Step 4 of the redesign: the header card above one open category's rows.
 *
 * Cover tile, name (commits on blur/Enter, duplicate-name guard), and
 * description (commits the same way). The cover reuses the dish-photo
 * pipeline — same shapes, same sizes, same UploadThing route — so the
 * sweep keeps treating category covers as referenced photos and removal
 * only clears the reference, exactly like dish photos.
 *
 * The card carries the theme's wash at its top: `accent-100` is the
 * prototype's `--wash`, fading into the card's own surface, so the section
 * head reads as the same surface as the rows rather than a grey box above
 * them.
 */

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

type CoverState =
  | { status: "idle" }
  | { status: "working"; percent: number }
  | { status: "error"; message: string };

export function CategoryHeader({
  doc,
  category,
  canUpload,
  onChange,
}: {
  doc: MenuDocument;
  category: MenuCategory;
  /** Signed in: the upload endpoint will authorize the photo. */
  canUpload: boolean;
  onChange: (next: MenuDocument) => void;
}) {
  const [coverState, setCoverState] = useState<CoverState>({ status: "idle" });
  const working = coverState.status === "working";
  const copy = itemImageCopy(category.cover);

  async function handleFile(file: File) {
    setCoverState({ status: "working", percent: 0 });
    try {
      const cover: MenuItemImage = await uploadItemImage(file, {
        onProgress: (percent) => setCoverState({ status: "working", percent }),
      });
      onChange(setCategoryCover(doc, category.id, cover));
      setCoverState({ status: "idle" });
    } catch (error) {
      setCoverState({
        status: "error",
        message:
          error instanceof ItemImageError
            ? error.message
            : "The cover photo could not be uploaded. Try again.",
      });
    }
  }

  return (
    <div className="rounded-xl border border-line-200 bg-linear-to-b from-accent-100 to-surface-base p-3">
      <div className="flex gap-3">
        {copy ? (
          // Plain CDN img, the same rule as dish photos: the optimizer must
          // never touch editor images.
          // eslint-disable-next-line @next/next/no-img-element -- category cover served straight from the CDN at its stored size
          <img
            src={copy.url}
            alt=""
            width={copy.width}
            height={copy.height}
            loading="lazy"
            decoding="async"
            className="h-16 w-16 shrink-0 rounded-lg border border-line-200 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-300 bg-surface-base text-ink-400"
          >
            <ImageIcon size={22} />
          </span>
        )}
        <div className="grid min-w-0 flex-1 gap-2">
          <CommitInput
            label={`Category ${category.sortOrder + 1} name`}
            value={category.name}
            validate={(name) =>
              isCategoryNameTaken(doc, name, category.id)
                ? `There is already a category called “${name.trim()}”.`
                : null
            }
            onCommit={(name) => onChange(renameCategory(doc, category.id, name.trim()))}
          />
          <CommitInput
            label="Description"
            value={category.description}
            validate={() => null}
            placeholder="Shown under the heading on the diner page"
            onCommit={(description) =>
              onChange(setCategoryDescription(doc, category.id, description))
            }
          />
        </div>
      </div>
      {canUpload && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <label
            className={`${smallButton} cursor-pointer ${working ? "pointer-events-none opacity-60" : ""}`}
          >
            {working ? "Uploading…" : copy ? "Replace cover" : "Add cover photo"}
            <input
              type="file"
              accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
              aria-label={`Cover photo for category ${category.name}`}
              className="sr-only"
              disabled={working}
              onChange={(event) => {
                const file = event.target.files?.[0];
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
                setCoverState({ status: "idle" });
                onChange(setCategoryCover(doc, category.id, null));
              }}
              className={smallButton}
            >
              Remove
            </button>
          )}
          <span className="text-[11px] text-ink-500">
            {copy ? "Shown above this section on the diner page." : "Optional."}
          </span>
        </div>
      )}
      {working && (
        <p role="status" className="mt-2 text-xs text-ink-500">
          Uploading cover photo… {coverState.percent}%
        </p>
      )}
      {coverState.status === "error" && (
        <p role="alert" className="mt-2 text-xs text-danger-700">
          {coverState.message}
        </p>
      )}
    </div>
  );
}

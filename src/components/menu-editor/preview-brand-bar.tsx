"use client";

import { useRef, useState } from "react";

import {
  brandAssetAspectWarning,
  type BrandAssetAspectWarning,
} from "@/features/brand-assets/aspect";
import { readBrandAssetSize } from "@/features/brand-assets/prepare";
import type { BrandAssetKind } from "@/features/brand-assets/schema";
import { uploadBrandAsset } from "@/features/brand-assets/upload";
import { ItemImageError } from "@/features/item-images/errors";
import { ItemImagePrepareError } from "@/features/item-images/prepare";
import { validateImageFile } from "@/lib/image-constraints";
import { updateBrandAssets, type RestaurantOption } from "@/features/tenancy/client";

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

type SlotState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "aspect"; file: File; warning: BrandAssetAspectWarning }
  | { status: "working"; percent: number }
  | { status: "error"; message: string };

/**
 * Preview-tab brand overlay: explicit Change logo / Change cover buttons.
 *
 * Reuses the Settings Brand upload flow unchanged — the same measure-first
 * (`readBrandAssetSize` + `brandAssetAspectWarning`), the same pre-sized
 * upload (`uploadBrandAsset`), and the same restaurant write
 * (`updateBrandAssets`). Only the chrome is preview-local: a compact bar
 * above the phone frame, so the owner never leaves Preview to fix the
 * header they are judging.
 */
export function PreviewBrandBar({
  restaurantId,
  onBrandChanged,
}: {
  restaurantId: string;
  /** File the server's answer so the header re-renders with the new asset. */
  onBrandChanged: (updated: RestaurantOption) => void;
}) {
  const [logoState, setLogoState] = useState<SlotState>({ status: "idle" });
  const [coverState, setCoverState] = useState<SlotState>({ status: "idle" });
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const setState = (kind: BrandAssetKind, state: SlotState) =>
    (kind === "logo" ? setLogoState : setCoverState)(state);

  async function upload(kind: BrandAssetKind, file: File) {
    setState(kind, { status: "working", percent: 0 });
    try {
      const image = await uploadBrandAsset(file, kind, {
        onProgress: (percent) => setState(kind, { status: "working", percent }),
      });
      const updated = await updateBrandAssets(restaurantId, { [kind]: image });
      onBrandChanged(updated);
      setState(kind, { status: "idle" });
    } catch (error) {
      setState(kind, {
        status: "error",
        message:
          error instanceof ItemImageError
            ? error.message
            : "The photo could not be uploaded. Try again.",
      });
    }
  }

  async function handleFile(kind: BrandAssetKind, file: File) {
    setState(kind, { status: "checking" });
    const early = validateImageFile(file);
    if (!early.valid) {
      setState(kind, { status: "error", message: early.message });
      return;
    }

    let warning: BrandAssetAspectWarning | null;
    try {
      warning = brandAssetAspectWarning(kind, await readBrandAssetSize(file));
    } catch (error) {
      setState(kind, {
        status: "error",
        message:
          error instanceof ItemImagePrepareError || error instanceof ItemImageError
            ? error.message
            : "This photo could not be read in your browser. Try a JPEG, PNG, or WebP.",
      });
      return;
    }

    if (warning) {
      setState(kind, { status: "aspect", file, warning });
      return;
    }
    await upload(kind, file);
  }

  return (
    <div className="mx-auto w-full max-w-[420px] rounded-2xl border border-line-200 bg-surface-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs leading-5 text-ink-500">
          Logo and cover show here live — fix them without leaving Preview.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {(["logo", "cover"] as const).map((kind) => {
            const inputRef = kind === "logo" ? logoInput : coverInput;
            const slotState = kind === "logo" ? logoState : coverState;
            const busy = slotState.status === "working" || slotState.status === "checking";
            return (
              <span key={kind}>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className={smallButton}
                >
                  {kind === "logo" ? "Change logo" : "Change cover"}
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  aria-label={kind === "logo" ? "Choose a logo file" : "Choose a cover photo file"}
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handleFile(kind, file);
                  }}
                />
              </span>
            );
          })}
        </div>
      </div>
      {(["logo", "cover"] as const).map((kind) => {
        const inputRef = kind === "logo" ? logoInput : coverInput;
        const state = kind === "logo" ? logoState : coverState;
        if (state.status === "idle") return null;
        return (
          <div key={kind} className="mt-2">
            {state.status === "checking" && (
              <p className="text-xs text-ink-500">Checking the photo…</p>
            )}
            {state.status === "working" && (
              <p className="text-xs text-ink-500">Uploading… {state.percent}%</p>
            )}
            {state.status === "error" && (
              <p role="alert" className="text-xs text-danger-700">
                {state.message}
              </p>
            )}
            {state.status === "aspect" && (
              <div className="rounded-lg border border-warning-300 bg-warning-50 px-2 py-1.5">
                <p role="alert" className="text-xs leading-5 text-warning-800">
                  {state.warning.message}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void upload(kind, state.file)}
                    className={smallButton}
                  >
                    Upload anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setState(kind, { status: "idle" });
                      inputRef.current?.click();
                    }}
                    className={smallButton}
                  >
                    Choose another
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

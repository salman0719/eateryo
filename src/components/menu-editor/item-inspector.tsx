"use client";

import { useState } from "react";

import { ChevronLeftIcon, CloseIcon } from "@/components/ui/icons";
import {
  hasAnyPrice,
  isItemFlagged,
  moveItemToCategory,
  setLabelMeaning,
  updateItem,
} from "@/features/menu/menu-utils";
import {
  cleanDietaryLabel,
  dedupeDietaryLabels,
  dietaryLabelMeaning,
  isStarterDietaryLabel,
} from "@/features/menu/dietary-labels";
import { addModifierTemplate } from "@/features/menu/modifier-templates";
import type { MenuDocument, MenuItem, MenuItemImage } from "@/features/menu/schema";

import { CommitInput, CommitNumber } from "./fields";
import { ItemImagePanel } from "./item-image-panel";
import { LabelPicker } from "./label-picker";
import { OptionGroupForm } from "./option-group-form";

/**
 * Step 14 of the redesign: the inspector for one dish.
 *
 * This is the half of the dish form that used to unfold underneath the row,
 * moved to its own column and compacted: identity and price first, then the
 * things a menu actually shows (description, photo, availability, labels,
 * sizes, add-ons), then the two facts that need deciding. Nothing here is
 * hidden behind a disclosure — the inspector is already the disclosure.
 *
 * The row keeps the flags (`Couldn't read`, `Possible duplicate`); the editor
 * keeps the document and the selection. This component only edits.
 *
 * Its header takes the same wash as the category header — `accent-100`, the
 * prototype's `--wash` — so the two columns read as one themed surface.
 */

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

// The display mode is composed by each control rather than baked in here: a
// base `inline-flex` would compete with the close button's `hidden`, and the
// cross appeared below `lg` on whichever utility the stylesheet ordered last.
const iconButtonBase =
  "h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-300 text-ink-600 " +
  "transition-colors hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-accent-700";

const iconButton = `inline-flex ${iconButtonBase}`;

const primaryButton =
  "rounded-full bg-accent-700 px-3 py-1 text-xs font-semibold text-on-accent transition-colors " +
  "hover:bg-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

export interface ItemInspectorProps {
  doc: MenuDocument;
  /** The category the dish lives in (its "Move to" list excludes it). */
  categoryId: string;
  categoryName: string;
  item: MenuItem;
  /** All categories, for the move-to-another-category control. */
  categories: Array<{ id: string; name: string }>;
  /** Position in the category, for the "dish 2 of 7" kicker. */
  position: number;
  count: number;
  canUploadImage: boolean;
  onChange: (next: MenuDocument) => void;
  onAttachImage: (image: MenuItemImage | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Close the inspector (back to the list on a phone). */
  onDone: () => void;
  /** Review the next dish in this category, wrapping. */
  onNext: () => void;
}

export function ItemInspector({
  doc,
  categoryId,
  categoryName,
  item,
  categories,
  position,
  count,
  canUploadImage,
  onChange,
  onAttachImage,
  onDuplicate,
  onDelete,
  onDone,
  onNext,
}: ItemInspectorProps) {
  const needsReview = isItemFlagged(item);
  const [applyPick, setApplyPick] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickedTemplate = doc.modifierTemplates.find((template) => template.name === applyPick);
  // Library templates not already on this dish, offered for one-tap apply.
  const appliableTemplates = doc.modifierTemplates.filter(
    (template) => !item.options.some((group) => group.name === template.name)
  );
  const chips = dedupeDietaryLabels(item.dietaryLabels);

  function patch(changes: Parameters<typeof updateItem>[3]) {
    onChange(updateItem(doc, categoryId, item.id, changes));
  }

  function toggleLabel(code: string, on: boolean) {
    const key = cleanDietaryLabel(code).toLowerCase();
    const current = dedupeDietaryLabels(item.dietaryLabels);
    const next = on
      ? current.some((label) => label.toLowerCase() === key)
        ? current
        : [...current, cleanDietaryLabel(code)]
      : current.filter((label) => label.toLowerCase() !== key);
    patch({ dietaryLabels: next });
  }

  /**
   * Add-new from the picker: the label lands on this dish, and a custom
   * code's meaning lands on the menu in the same document — one change, so
   * the two can never half-save. Starter codes keep their dictionary
   * explanations.
   */
  function addNewLabel(code: string, meaning: string) {
    const label = cleanDietaryLabel(code);
    const key = label.toLowerCase();
    const current = dedupeDietaryLabels(item.dietaryLabels);
    const next = current.some((entry) => entry.toLowerCase() === key)
      ? current
      : [...current, label];
    const withLabel = updateItem(doc, categoryId, item.id, { dietaryLabels: next });
    onChange(
      !isStarterDietaryLabel(label) && cleanDietaryLabel(meaning) !== ""
        ? setLabelMeaning(withLabel, label, meaning)
        : withLabel
    );
  }

  return (
    <div className="rounded-2xl border border-line-200 bg-surface-base">
      {/* Sticky so the dish's name and its way out stay in view while a
          long form scrolls under them. The card itself cannot clip its
          corners (`overflow-hidden` would trap this), so the header and
          footer round their own edges. */}
      <div className="sticky top-0 z-10 flex items-start gap-2 rounded-t-2xl border-b border-line-200 bg-linear-to-b from-accent-100 to-surface-base px-3 py-2.5">
        {/* On a phone the inspector has replaced the list, so its way out is
            a back chevron and belongs on the leading edge. Beside the list on
            a wide screen the same control sat on the right and read as a
            second "next", so there it becomes an explicit close. */}
        <button
          type="button"
          onClick={onDone}
          aria-label="Close the dish editor"
          className={`${iconButton} lg:hidden`}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            {categoryName || "Untitled category"} · dish {position} of {count}
          </p>
          <h3 className="truncate text-sm font-semibold text-ink-900">
            {item.name || "Untitled item"}
          </h3>
        </div>
        <button
          type="button"
          onClick={onDone}
          aria-label="Close the dish editor"
          className={`hidden ${iconButtonBase} lg:inline-flex`}
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_100px_80px]">
          <CommitInput
            label="Item name"
            value={item.name}
            onCommit={(name) => patch({ name: name.trim() })}
          />
          <CommitNumber
            label="Price"
            value={item.price}
            placeholder={item.variants.length > 0 ? "Per size" : "Blank if unknown"}
            onCommit={(price) =>
              patch(!hasAnyPrice(item) && price !== null ? { price, reviewNotes: [] } : { price })
            }
          />
          <CommitInput
            label="Currency"
            value={item.currency ?? ""}
            validate={() => null}
            placeholder="e.g. $"
            onCommit={(currency) => patch({ currency: currency.trim() ? currency.trim() : null })}
          />
        </div>

        <div className="mt-3">
          <CommitInput
            label="Description"
            value={item.description ?? ""}
            validate={() => null}
            placeholder="Blank if none shown"
            multiline
            onCommit={(description) =>
              patch({ description: description.trim() ? description : null })
            }
          />
        </div>

        <div className="mt-3">
          <span
            id={`availability-label-${item.id}`}
            className="mb-1 block text-xs font-medium text-ink-500"
          >
            Availability
          </span>
          <div
            role="group"
            aria-labelledby={`availability-label-${item.id}`}
            className="inline-flex rounded-full border border-line-300 bg-surface-base p-0.5"
          >
            {(
              [
                { value: "unknown", label: "Unknown" },
                { value: "available", label: "Available" },
                { value: "unavailable", label: "Unavailable" },
              ] as const
            ).map((option) => {
              const pressed =
                option.value ===
                (item.available === null
                  ? "unknown"
                  : item.available
                    ? "available"
                    : "unavailable");
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() =>
                    patch({
                      available: option.value === "unknown" ? null : option.value === "available",
                    })
                  }
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 ${
                    pressed ? "bg-accent-700 text-on-accent" : "text-ink-600 hover:text-ink-900"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          <ItemImagePanel item={item} canUpload={canUploadImage} onAttach={onAttachImage} />
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
              Dietary labels
            </p>
            <span className="flex-1" />
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
              className={smallButton}
            >
              {chips.length > 0 ? "Edit labels" : "+ Add labels"}
            </button>
          </div>
          {chips.length > 0 ? (
            <p className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.map((label) => {
                const meaning = dietaryLabelMeaning(doc, label);
                return (
                  <span
                    key={label}
                    tabIndex={0}
                    title={meaning ?? undefined}
                    className="rounded-full bg-surface-100 px-2.5 py-0.5 text-xs font-medium text-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                  >
                    {label}
                  </span>
                );
              })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-500">
              No labels — only labels the menu itself shows, never inferred.
            </p>
          )}
        </div>
        {pickerOpen && (
          <LabelPicker
            doc={doc}
            applied={chips}
            onToggle={toggleLabel}
            onAddNew={addNewLabel}
            onClose={() => setPickerOpen(false)}
          />
        )}

        <div className="mt-3 rounded-lg bg-surface-50 p-3">
          <p className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
            Variants / sizes
          </p>
          {item.variants.length === 0 && (
            <p className="mt-1 text-xs text-ink-500">None — add one if the menu shows sizes.</p>
          )}
          <ul className="mt-2 space-y-2">
            {item.variants.map((variant, vIndex) => (
              <li
                key={`${variant.name}-${vIndex}`}
                className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_100px_auto]"
              >
                <CommitInput
                  label={vIndex === 0 ? "Name" : `Variant ${vIndex + 1}`}
                  value={variant.name}
                  onCommit={(name) =>
                    patch({
                      variants: item.variants.map((v, i) =>
                        i === vIndex ? { ...v, name: name.trim() } : v
                      ),
                    })
                  }
                />
                <CommitNumber
                  label="Price"
                  value={variant.price}
                  onCommit={(price) =>
                    patch({
                      variants: item.variants.map((v, i) => (i === vIndex ? { ...v, price } : v)),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove variant ${variant.name}`}
                  onClick={() => patch({ variants: item.variants.filter((_, i) => i !== vIndex) })}
                  className={smallButton}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              patch({ variants: [...item.variants, { name: "New size", price: null }] })
            }
            className={`${smallButton} mt-2`}
          >
            + Add variant
          </button>
        </div>

        {/* Options / add-ons: groups of add-on choices (sauces, toppings)
            the diner picks at order time. Rules live on the group so the
            diner page and the server enforce the same contract: required
            groups gate Add, single-pick renders radios, multi-pick renders
            checkboxes, and deltas price server-side from the snapshot. */}
        <div className="mt-3 rounded-lg bg-surface-50 p-3">
          <p className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
            Options / add-ons
          </p>
          {item.options.length === 0 && (
            <p className="mt-1 text-xs text-ink-500">
              None — add a group if the menu shows choices.
            </p>
          )}
          {appliableTemplates.length > 0 && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="min-w-[140px] flex-1 text-xs text-ink-600">
                Apply an add-on set
                <select
                  value={applyPick}
                  onChange={(event) => setApplyPick(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-line-300 bg-surface-base px-2 py-1.5 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
                >
                  <option value="">Choose…</option>
                  {appliableTemplates.map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!pickedTemplate}
                onClick={() => {
                  if (!pickedTemplate) return;
                  patch({ options: [...item.options, pickedTemplate] });
                  setApplyPick("");
                }}
                className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Apply
              </button>
            </div>
          )}
          <ul className="mt-2 space-y-3">
            {item.options.map((option, oIndex) => {
              const inLibrary = doc.modifierTemplates.some(
                (template) => template.name === option.name
              );
              return (
                <OptionGroupForm
                  key={`${option.name}-${oIndex}`}
                  group={option}
                  onChange={(next) =>
                    patch({
                      options: item.options.map((o, i) => (i === oIndex ? next : o)),
                    })
                  }
                  onRemove={() => patch({ options: item.options.filter((_, i) => i !== oIndex) })}
                  removeLabel={`Remove option group ${option.name}`}
                  footer={
                    inLibrary ? (
                      <p className="mt-2 text-[11px] text-ink-500">
                        Saved in the add-on sets library.
                      </p>
                    ) : (
                      <button
                        type="button"
                        title="Copy this group into the add-on sets so other dishes can use it"
                        onClick={() => onChange(addModifierTemplate(doc, option))}
                        className={`${smallButton} mt-2`}
                      >
                        Save as add-on set
                      </button>
                    )
                  }
                />
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() =>
              patch({
                options: [
                  ...item.options,
                  {
                    name: "New option",
                    min: 0,
                    max: null,
                    // A group is never left empty: an empty group is a dead
                    // end the diner cannot satisfy, so it arrives with one
                    // choice to rename and price.
                    choices: [{ name: "New choice", priceDelta: null }],
                  },
                ],
              })
            }
            className={`${smallButton} mt-2`}
          >
            + Add option group
          </button>
        </div>

        {categories.length > 1 && (
          <label className="mt-3 flex items-center gap-1.5 text-xs text-ink-600">
            Move to
            <select
              aria-label={`Move ${item.name} to another category`}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) {
                  onChange(moveItemToCategory(doc, categoryId, event.target.value, item.id));
                  event.target.value = "";
                }
              }}
              className="rounded-full border border-line-300 bg-surface-base px-2 py-1 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
            >
              <option value="">Category…</option>
              {categories
                .filter((category) => category.id !== categoryId)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
        )}

        {item.reviewNotes.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 rounded-lg bg-warning-50 p-3 pl-8 text-xs text-warning-900">
            {item.reviewNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {needsReview && (
          <div className="mt-2 flex flex-wrap gap-2">
            {hasAnyPrice(item) ? (
              <button
                type="button"
                onClick={() => patch({ reviewNotes: [] })}
                className={`${smallButton} border-accent-300 text-accent-800 hover:border-accent-700 hover:text-accent-900`}
              >
                ✓ Looks good
              </button>
            ) : (
              <button
                type="button"
                onClick={() => patch({ reviewNotes: [], unpricedAccepted: true })}
                title="Keeps the price blank — totals stay honestly blank for this item."
                className={`${smallButton} border-accent-300 text-accent-800 hover:border-accent-700 hover:text-accent-900`}
              >
                ✓ Leave unpriced
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-line-200 bg-surface-50 px-3 py-2">
        <button type="button" onClick={onDuplicate} className={smallButton}>
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${smallButton} hover:border-danger-700 hover:text-danger-800`}
        >
          Delete
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onNext} className={smallButton}>
          Next dish ›
        </button>
        <button type="button" onClick={onDone} className={primaryButton}>
          Done
        </button>
      </div>
    </div>
  );
}

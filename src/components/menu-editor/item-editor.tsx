"use client";

import { memo } from "react";

import { Collapse } from "@/components/ui/collapse";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";
import {
  duplicateItem,
  hasAnyPrice,
  isItemFlagged,
  moveItemToCategory,
  updateItem,
} from "@/features/menu/menu-utils";
import { formatItemPrice } from "@/features/menu/preview-utils";
import type { MenuDocument, MenuItem, MenuItemImage } from "@/features/menu/schema";
import { itemImageCopy } from "@/features/item-images/ref";

import { CommitInput, CommitNumber, CommitTags } from "./fields";
import { ItemImagePanel } from "./item-image-panel";

interface ItemEditorProps {
  doc: MenuDocument;
  /** Deep-link target: a pasted /menus/<id>/items/<itemId> URL scrolls here
      and rings it, even though nothing in the UI links to items. */
  isRouteTarget: boolean;
  categoryId: string;
  item: MenuItem;
  /** All categories, for the move-to-another-category control. */
  categories: Array<{ id: string; name: string }>;
  /**
   * The row's write path, created once by the editor. Keeping it in one stable
   * object (rather than a handful of fresh closures per row) is what lets this
   * component's memo actually hold when a fold toggle re-renders the editor.
   */
  actions: ItemActions;
  /** Labels this menu already uses, computed once for the whole editor. */
  labelVocabulary: readonly string[];
  /** Flagged by duplicate detection (review-only badge, see duplicates.ts). */
  duplicate: boolean;
  /**
   * Whether this dish's form is showing. The row itself is always visible:
   * the form is the exception, which is what keeps a long menu navigable.
   */
  open: boolean;
  /** Bulk reassignment checkbox state (see menu-editor's bulk actions bar). */
  selected: boolean;
  /** Signed in, so the upload endpoint will authorize a photo. */
  canUploadImage: boolean;
}

/** Everything a row can ask the editor to do, addressed by id. */
export interface ItemActions {
  change: (next: MenuDocument) => void;
  /** Show or hide this dish's form. */
  toggleOpen: (itemId: string) => void;
  /** Tick or untick this dish for a bulk move. */
  toggleSelected: (itemId: string) => void;
  /** Ask for confirmation, then delete — with the editor's one-level undo. */
  delete: (categoryId: string, itemId: string) => void;
  /** Attach, replace, or (null) remove a dish's photo. */
  attachImage: (itemId: string, image: MenuItemImage | null) => void;
}

const smallButton =
  "rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors " +
  "hover:border-accent-700 hover:text-accent-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700";

export const ItemEditor = memo(function ItemEditor({
  doc,
  categoryId,
  isRouteTarget,
  item,
  categories,
  actions,
  labelVocabulary,
  duplicate,
  open,
  selected,
  canUploadImage,
}: ItemEditorProps) {
  const needsReview = isItemFlagged(item);
  // The photo reference for the row thumbnail; the form below owns changing it.
  const copy = itemImageCopy(item.image);
  const panelId = `menu-item-panel-${item.id}`;
  /**
   * What the closed row says under the name: the description when the menu has
   * one, then the shape of the dish — so a row whose fields are hidden still
   * says it has sizes and option groups behind it.
   */
  const shape: string[] = [];
  if (item.variants.length > 0) {
    shape.push(`${item.variants.length} ${item.variants.length === 1 ? "size" : "sizes"}`);
  }
  if (item.options.length > 0) {
    const choiceCount = item.options.reduce((sum, group) => sum + group.choices.length, 0);
    shape.push(
      `${item.options.length} ${item.options.length === 1 ? "option group" : "option groups"} · ${choiceCount} ${choiceCount === 1 ? "choice" : "choices"}`
    );
  }
  const rowSummary = [item.description?.trim() ?? "", shape.join(" · ")]
    .filter((part) => part.length > 0)
    .join(" · ");

  function patch(patch: Parameters<typeof updateItem>[3]) {
    actions.change(updateItem(doc, categoryId, item.id, patch));
  }

  return (
    <li
      id={`menu-item-${item.id}`}
      className={`rounded-xl border bg-surface-base ${isRouteTarget ? "border-accent-600 ring-2 ring-accent-200" : "border-line-200"}`}
    >
      {/* The row is the dish: name, price, and the flags that need attention,
          so nothing important is hidden behind the collapse. */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 sm:px-3 ${open ? "" : "rounded-xl"} ${selected ? "bg-warning-50/70" : ""}`}
      >
        <label
          title="Select for bulk move"
          className="flex min-h-[32px] min-w-[28px] cursor-pointer items-center justify-center pointer-coarse:min-h-[44px]"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => actions.toggleSelected(item.id)}
            aria-label={`Select ${item.name} for bulk move`}
            className="h-4 w-4 rounded border-line-300 accent-accent-700"
          />
        </label>
        {copy ? (
          <img
            src={copy.url}
            alt=""
            width={copy.width}
            height={copy.height}
            loading="lazy"
            decoding="async"
            className="h-8 w-8 shrink-0 rounded-md border border-line-200 object-cover"
          />
        ) : null}
        <button
          type="button"
          onClick={() => actions.toggleOpen(item.id)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold text-ink-900">
                {item.name || "Untitled item"}
              </span>
              {needsReview && (
                <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900">
                  {hasAnyPrice(item) ? "Couldn't read" : "Check price"}
                </span>
              )}
              {duplicate && (
                <span className="rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-medium text-danger-900">
                  Possible duplicate
                </span>
              )}
            </span>
            {!open && rowSummary && (
              <span className="mt-0.5 block truncate text-xs text-ink-500">{rowSummary}</span>
            )}
          </span>
          <span className="shrink-0 text-sm whitespace-nowrap tabular-nums text-ink-600">
            {formatItemPrice(item, doc.currency)}
          </span>
          {open ? (
            <ChevronUpIcon className="shrink-0 text-ink-400" />
          ) : (
            <ChevronDownIcon className="shrink-0 text-ink-400" />
          )}
        </button>
      </div>
      {/* Lazy: forty shut dish forms must not cost ~5,000 DOM nodes, and this
          one is rebuilt from the document when it is reopened. */}
      <Collapse open={open} lazy>
        <div id={panelId} className="border-t border-line-100 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_90px]">
            <CommitInput
              label="Item name"
              value={item.name}
              onCommit={(name) => patch({ name: name.trim() })}
            />
            <CommitNumber
              label="Price"
              value={item.price}
              placeholder={
                item.variants.length > 0 ? "Blank — priced per size" : "Blank if unknown"
              }
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

          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_170px]">
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
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">Availability</span>
              <select
                aria-label={`Availability of ${item.name}`}
                value={item.available === null ? "unknown" : item.available ? "yes" : "no"}
                onChange={(event) => {
                  const v = event.target.value;
                  patch({ available: v === "unknown" ? null : v === "yes" });
                }}
                className="w-full rounded-lg border border-line-300 bg-surface-base px-2.5 py-1.5 text-sm text-ink-900 focus:border-accent-700 focus:outline-none"
              >
                <option value="unknown">Unknown</option>
                <option value="yes">Available</option>
                <option value="no">Unavailable</option>
              </select>
            </label>
          </div>

          <div className="mt-3">
            <ItemImagePanel
              item={item}
              canUpload={canUploadImage}
              onAttach={(image) => actions.attachImage(item.id, image)}
            />
          </div>

          <div className="mt-3">
            <CommitTags
              label="Dietary labels"
              value={item.dietaryLabels}
              suggestions={labelVocabulary}
              placeholder="Add a label…"
              hint="Only labels the menu itself shows — never inferred."
              onCommit={(dietaryLabels) => patch({ dietaryLabels })}
            />
          </div>

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
                  className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_110px_auto]"
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
                    onClick={() =>
                      patch({ variants: item.variants.filter((_, i) => i !== vIndex) })
                    }
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
            <ul className="mt-2 space-y-3">
              {item.options.map((option, oIndex) => (
                <li
                  key={`${option.name}-${oIndex}`}
                  className="rounded-lg border border-line-200 bg-surface-base p-2.5"
                >
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <CommitInput
                      label="Option group"
                      value={option.name}
                      onCommit={(name) =>
                        patch({
                          options: item.options.map((o, i) =>
                            i === oIndex ? { ...o, name: name.trim() } : o
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove option group ${option.name}`}
                      onClick={() =>
                        patch({ options: item.options.filter((_, i) => i !== oIndex) })
                      }
                      className={smallButton}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_90px_90px]">
                    <label className="flex items-center gap-2 rounded-lg border border-line-200 bg-surface-base px-2.5 py-2 text-xs text-ink-700">
                      <input
                        type="checkbox"
                        checked={option.required}
                        onChange={(event) =>
                          patch({
                            options: item.options.map((o, i) =>
                              i === oIndex ? { ...o, required: event.target.checked } : o
                            ),
                          })
                        }
                        className="h-4 w-4 rounded accent-accent-700"
                      />
                      Required
                    </label>
                    <label className="text-xs text-ink-600">
                      Picks
                      <select
                        value={option.selection}
                        onChange={(event) =>
                          patch({
                            options: item.options.map((o, i) =>
                              i === oIndex
                                ? { ...o, selection: event.target.value as "one" | "many" }
                                : o
                            ),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-line-300 bg-surface-base px-2 py-1.5 text-xs text-ink-700 focus:border-accent-700 focus:outline-none"
                      >
                        <option value="one">One</option>
                        <option value="many">Many</option>
                      </select>
                    </label>
                    <CommitNumber
                      label="Min"
                      value={option.min}
                      placeholder="0"
                      onCommit={(min) =>
                        patch({
                          options: item.options.map((o, i) =>
                            i === oIndex
                              ? { ...o, min: min === null ? 0 : Math.max(0, Math.trunc(min)) }
                              : o
                          ),
                        })
                      }
                    />
                    <CommitNumber
                      label="Max"
                      value={option.max}
                      placeholder="No limit"
                      onCommit={(max) =>
                        patch({
                          options: item.options.map((o, i) =>
                            i === oIndex
                              ? { ...o, max: max === null ? null : Math.max(1, Math.trunc(max)) }
                              : o
                          ),
                        })
                      }
                    />
                  </div>
                  {option.choices.length === 0 && (
                    <p className="mt-2 rounded-lg bg-warning-50 px-2.5 py-1.5 text-xs text-warning-900">
                      No choices yet — add at least one, or diners can never satisfy
                      {option.required ? " this required" : " this"} group.
                    </p>
                  )}
                  <ul className="mt-2 space-y-2">
                    {option.choices.map((choice, cIndex) => (
                      <li
                        key={`${choice.name}-${cIndex}`}
                        className="grid grid-cols-1 items-end gap-2 pl-3 sm:grid-cols-[1fr_110px_auto]"
                      >
                        <CommitInput
                          label="Choice"
                          value={choice.name}
                          onCommit={(name) =>
                            patch({
                              options: item.options.map((o, i) =>
                                i === oIndex
                                  ? {
                                      ...o,
                                      choices: o.choices.map((c, j) =>
                                        j === cIndex ? { ...c, name: name.trim() } : c
                                      ),
                                    }
                                  : o
                              ),
                            })
                          }
                        />
                        <CommitNumber
                          label="Extra"
                          value={choice.priceDelta}
                          onCommit={(priceDelta) =>
                            patch({
                              options: item.options.map((o, i) =>
                                i === oIndex
                                  ? {
                                      ...o,
                                      choices: o.choices.map((c, j) =>
                                        j === cIndex ? { ...c, priceDelta } : c
                                      ),
                                    }
                                  : o
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Remove choice ${choice.name}`}
                          onClick={() =>
                            patch({
                              options: item.options.map((o, i) =>
                                i === oIndex
                                  ? { ...o, choices: o.choices.filter((_, j) => j !== cIndex) }
                                  : o
                              ),
                            })
                          }
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
                      patch({
                        options: item.options.map((o, i) =>
                          i === oIndex
                            ? {
                                ...o,
                                choices: [...o.choices, { name: "New choice", priceDelta: null }],
                              }
                            : o
                        ),
                      })
                    }
                    className={`${smallButton} mt-2`}
                  >
                    + Add choice
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                patch({
                  options: [
                    ...item.options,
                    {
                      name: "New option",
                      required: false,
                      selection: "one",
                      min: 0,
                      max: null,
                      allowDuplicates: false,
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
                  className={`${smallButton} border-success-300 text-success-800 hover:border-success-700 hover:text-success-900`}
                >
                  ✓ Looks good
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => patch({ reviewNotes: [], unpricedAccepted: true })}
                  title="Keeps the price blank — totals stay honestly blank for this item."
                  className={`${smallButton} border-success-300 text-success-800 hover:border-success-700 hover:text-success-900`}
                >
                  ✓ Leave unpriced
                </button>
              )}
            </div>
          )}

          {/* One control group per row on phones (sm:contents dissolves the rows
          back into today's single wrapping row, so desktop is unchanged). */}
          <div className="mt-3 flex flex-col gap-2 border-t border-line-100 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
            {categories.length > 1 && (
              <div className="sm:contents">
                <label className="flex w-full flex-col gap-1 text-xs text-ink-500 sm:w-auto sm:flex-row sm:items-center sm:gap-1.5">
                  Move to
                  <select
                    aria-label={`Move ${item.name} to another category`}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) {
                        actions.change(
                          moveItemToCategory(doc, categoryId, event.target.value, item.id)
                        );
                        event.target.value = "";
                      }
                    }}
                    className="w-full rounded-full border border-line-300 bg-surface-base px-2 py-1 text-xs text-ink-700 focus:border-accent-700 focus:outline-none sm:w-auto"
                  >
                    <option value="">Category…</option>
                    {categories
                      .filter((c) => c.id !== categoryId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:contents">
              {needsReview && (
                <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-900">
                  {hasAnyPrice(item) ? "Couldn't read" : "Check price"}
                </span>
              )}
              {duplicate && (
                <span className="rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-medium text-danger-900">
                  Possible duplicate
                </span>
              )}
            </div>
            <span className="hidden flex-1 sm:block" />
            <div className="flex gap-2 sm:contents">
              <button
                type="button"
                onClick={() => actions.change(duplicateItem(doc, categoryId, item.id))}
                className={`${smallButton} flex-1 sm:flex-none`}
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => actions.delete(categoryId, item.id)}
                className="flex-1 rounded-full border border-line-300 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-danger-700 hover:text-danger-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-700 sm:flex-none"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </Collapse>
    </li>
  );
});

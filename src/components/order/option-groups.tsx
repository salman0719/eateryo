"use client";

/**
 * Diner-facing option-group picker (P1: sauces, toppings, add-ons).
 *
 * One component for every order surface: the diner page, the multi-menu
 * landing, and the owner preview all share `OrderMenuSection`, so they share
 * this picker too and cannot drift apart. Groups render as radios
 * (pick-one) or checkboxes (pick-many); the parent owns the pick list and
 * the Add-gate, this file only renders fields and toggles picks.
 */

import { formatPriceDelta } from "@/features/menu/preview-utils";
import type { OptionSelection } from "@/features/menu/option-groups";
import type { OrderLineOption } from "@/features/orders/schema";

interface OptionGroupLike {
  name: string;
  min: number;
  max: number | null;
  choices: ReadonlyArray<{ name: string; priceDelta: number | null }>;
}

interface ItemWithGroups {
  id: string;
  name: string;
  options: ReadonlyArray<OptionGroupLike>;
}

/**
 * Toggle one pick: max-1 groups replace the group's answer, the rest add or
 * remove the choice. An empty choice name clears the group — the None
 * radio's path (radios cannot uncheck themselves). Pure so the cart key and
 * the Add-gate share the exact same picks the diner tapped.
 */
export function toggleOptionSelection(
  selections: ReadonlyArray<OptionSelection>,
  group: Pick<OptionGroupLike, "name" | "min" | "max">,
  choiceName: string
): OptionSelection[] {
  const groupName = group.name;
  if (!choiceName.trim()) {
    return selections.filter((selection) => selection.groupName !== groupName);
  }
  if (group.max === 1) {
    return [
      ...selections.filter((selection) => selection.groupName !== groupName),
      { groupName, choiceName },
    ];
  }
  const exists = selections.some(
    (selection) => selection.groupName === groupName && selection.choiceName === choiceName
  );
  if (exists) {
    return selections.filter(
      (selection) => !(selection.groupName === groupName && selection.choiceName === choiceName)
    );
  }
  return [...selections, { groupName, choiceName }];
}

/**
 * One line's picks wherever an order is read back: the cart, the staff
 * board, the owner preview. Names come from the order snapshot, so a later
 * menu rename never rewrites what the kitchen saw.
 */
export function OrderLineOptions({
  options,
  currency,
}: {
  options: ReadonlyArray<OrderLineOption>;
  currency: string | null;
}) {
  if (options.length === 0) return null;
  return (
    <span className="ml-1 text-xs font-normal text-ink-500">
      ·{" "}
      {options
        .map((option) => {
          const delta = formatPriceDelta(option.priceDelta);
          return delta
            ? `${option.choiceName} ${delta}${currency ? ` ${currency}` : ""}`
            : option.choiceName;
        })
        .join(", ")}
    </span>
  );
}

export function OptionGroupFields({
  item,
  currency,
  selections,
  onToggle,
}: {
  item: ItemWithGroups;
  currency: string | null;
  selections: ReadonlyArray<OptionSelection>;
  onToggle: (groupName: string, choiceName: string) => void;
}) {
  if (item.options.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {item.options.map((group) => {
        const picked = selections.filter((selection) => selection.groupName === group.name);
        // One widget follows the rule: max 1 renders radios, anything else
        // checkboxes. Radios cannot uncheck, so an optional single-pick gets
        // an explicit None.
        const single = group.max === 1;
        const skippable = group.min === 0;
        // Cap reached: further ticks would only fail the Add check, so the
        // unticked boxes go quiet while picked ones stay removable.
        const atCap = !single && group.max !== null && picked.length >= group.max;
        const range =
          group.max === null
            ? group.min > 1
              ? `Pick at least ${group.min}`
              : null
            : single
              ? skippable
                ? "Pick one or none"
                : "Pick one"
              : `Pick ${group.min}–${group.max}`;
        return (
          <fieldset
            key={group.name}
            className="rounded-xl border border-line-200 bg-surface-50 px-3 py-2"
          >
            <legend className="px-1 text-xs font-semibold text-ink-700">
              {group.name}
              {group.min > 0 ? (
                <span className="ml-1 text-accent-700">Required</span>
              ) : (
                <span className="ml-1 font-normal text-ink-500">Optional</span>
              )}
              {range && <span className="ml-1 font-normal text-ink-500">{range}</span>}
            </legend>
            <div className="flex flex-col gap-1">
              {single && skippable && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm text-ink-800 hover:bg-surface-100">
                  <input
                    type="radio"
                    name={`options-${item.id}-${group.name}`}
                    checked={picked.length === 0}
                    onChange={() => onToggle(group.name, "")}
                    className="h-4 w-4 shrink-0 accent-accent-700"
                  />
                  <span className="min-w-0 flex-1 truncate">None</span>
                </label>
              )}
              {group.choices.map((choice) => {
                const checked = picked.some((selection) => selection.choiceName === choice.name);
                const disabled = atCap && !checked;
                const delta = formatPriceDelta(choice.priceDelta);
                const inputName = `options-${item.id}-${group.name}`;
                return (
                  <label
                    key={choice.name}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm text-ink-800 hover:bg-surface-100"
                  >
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={single ? inputName : undefined}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(group.name, choice.name)}
                      className="h-4 w-4 shrink-0 accent-accent-700"
                    />
                    <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                    {delta && (
                      <span className="shrink-0 text-xs tabular-nums text-ink-500">
                        {delta}
                        {currency ? ` ${currency}` : ""}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

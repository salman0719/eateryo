"use client";

/**
 * Diner-facing option-group picker (P1: sauces, toppings, add-ons).
 *
 * One component for every order surface: the diner page, the multi-menu
 * landing, and the owner preview all share `OrderMenuSection`, so they share
 * this picker too and cannot drift apart. Groups render as radios
 * (pick-one) or checkboxes (pick-many); the parent owns the pick list and
 * the Add-gate, this file only renders fields and toggles picks.
 *
 * Required groups (min > 0) render open — the diner must answer them. Every
 * optional group starts shut behind one row (name, its picks so far or a
 * from-price, a chevron) and glides open through the shared `Collapse`, so
 * a dish with four groups reads as one decision plus three invitations.
 */

import { useState } from "react";

import { Collapse } from "@/components/ui/collapse";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";
import { formatPriceDelta } from "@/features/menu/preview-utils";
import { formatSelectionsSummary, type OptionSelection } from "@/features/menu/option-groups";
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
 *
 * Always its own wrapping line under the dish name — never inline in a
 * truncating row, so a long pick list wraps instead of being cut off.
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
    <span className="mt-0.5 block text-xs font-normal text-ink-500">
      {options.map((option, index) => {
        const delta = formatPriceDelta(option.priceDelta);
        const text = delta
          ? `${option.choiceName} ${delta}${currency ? ` ${currency}` : ""}`
          : option.choiceName;
        // One pick never breaks across lines: the number and its currency
        // stay together, and wrapping happens at the commas between picks.
        return (
          <span key={`${option.groupName}-${option.choiceName}`} className="whitespace-nowrap">
            {index > 0 ? ", " : null}
            {text}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Cheapest charged choice, for the shut row's "from +1.50" hint. Only
 * positive deltas count: free choices are not a price signal, and unknown
 * ones must never be invented.
 */
function cheapestExtra(group: OptionGroupLike, currency: string | null): string | null {
  const extras = group.choices
    .map((choice) => choice.priceDelta)
    .filter((delta): delta is number => delta !== null && delta > 0);
  if (extras.length === 0) return null;
  const hint = formatPriceDelta(Math.min(...extras));
  return `from ${hint}${currency ? ` ${currency}` : ""}`;
}

function OptionGroupBlock({
  itemId,
  group,
  currency,
  picks,
  onToggle,
}: {
  itemId: string;
  group: OptionGroupLike;
  currency: string | null;
  picks: ReadonlyArray<OptionSelection>;
  onToggle: (groupName: string, choiceName: string) => void;
}) {
  const required = group.min > 0;
  // Required starts open (it gates Add); optional starts shut. The flag is
  // static per group, so it is a safe initial state.
  const [open, setOpen] = useState(required);
  // One widget follows the rule: max 1 renders radios, anything else
  // checkboxes. Radios cannot uncheck, so an optional single-pick gets
  // an explicit None.
  const single = group.max === 1;
  const skippable = group.min === 0;
  // Cap reached: further ticks would only fail the Add check, so the
  // unticked boxes go quiet while picked ones stay removable.
  const atCap = !single && group.max !== null && picks.length >= group.max;
  const range = single
    ? skippable
      ? "Pick one or none"
      : "Pick one"
    : group.max === null
      ? skippable
        ? "Pick any"
        : `Pick at least ${group.min}`
      : skippable
        ? `Up to ${group.max}`
        : `Pick ${group.min}–${group.max}`;
  const summary = formatSelectionsSummary(picks);
  const inputName = `options-${itemId}-${group.name}`;
  const choices = (
    <div className="flex flex-col gap-1 px-3 pt-1 pb-2">
      {single && skippable && (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm text-ink-800 hover:bg-surface-100">
          <input
            type="radio"
            name={inputName}
            checked={picks.length === 0}
            onChange={() => onToggle(group.name, "")}
            className="h-4 w-4 shrink-0 accent-accent-700"
          />
          <span className="min-w-0 flex-1 truncate">None</span>
        </label>
      )}
      {group.choices.map((choice) => {
        const checked = picks.some((selection) => selection.choiceName === choice.name);
        const disabled = atCap && !checked;
        const delta = formatPriceDelta(choice.priceDelta);
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
  );
  return (
    <div
      role="group"
      aria-label={group.name}
      className="rounded-xl border border-line-200 bg-surface-50"
    >
      {required ? (
        <p className="px-3 pt-2 text-xs font-semibold text-ink-700">
          {group.name}
          <span className="ml-1 text-accent-700">Required</span>
          <span className="ml-1 font-normal text-ink-500">{range}</span>
        </p>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-700">
            {group.name}
            <span className="ml-1 font-normal text-ink-500">Optional</span>
            <span className="ml-1 font-normal text-ink-500">{range}</span>
          </span>
          {(summary || cheapestExtra(group, currency)) && (
            <span className="shrink-0 truncate text-xs text-ink-500">
              {summary || cheapestExtra(group, currency)}
            </span>
          )}
          {open ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </button>
      )}
      <Collapse open={open}>{choices}</Collapse>
    </div>
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
      {item.options.map((group) => (
        <OptionGroupBlock
          key={group.name}
          itemId={item.id}
          group={group}
          currency={currency}
          picks={selections.filter((selection) => selection.groupName === group.name)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

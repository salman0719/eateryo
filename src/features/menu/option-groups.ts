/**
 * Pure option-group rules for menu items (P1: sauces, toppings, add-ons).
 *
 * The canonical schema stores each group as name + rules + priced choices;
 * everything here reads that shape without touching storage, so the editor,
 * the diner page, and the server resolver all enforce the same contract:
 * - required groups must be answered before the dish can be ordered;
 * - "one" groups take a single choice, "many" groups take up to `max`;
 * - deltas are summed onto the dish price; an unknown delta makes the line
 *   unpriced (never invented — totals stay honestly null downstream).
 *
 * Groups are matched by name, like size variants: extraction produces names,
 * not ids, and the editor renames in place. History rows snapshot the
 * resolved names + deltas, so a later rename never rewrites an old order.
 */

/** One picked choice: the group it answers and the choice taken. */
export interface OptionSelection {
  groupName: string;
  choiceName: string;
}

interface OptionGroupLike {
  name: string;
  required: boolean;
  selection: "one" | "many";
  min: number;
  max: number | null;
  allowDuplicates: boolean;
  choices: ReadonlyArray<{ name: string; priceDelta: number | null }>;
}

interface ItemWithOptions {
  name: string;
  options: ReadonlyArray<OptionGroupLike>;
}

function trimmed(value: string): string {
  return value.trim();
}

/**
 * Validate a diner's picks against an item's groups. Returns the first
 * human-readable problem, or null when the picks can be ordered.
 */
export function validateOptionSelections(
  item: Pick<ItemWithOptions, "name" | "options">,
  selections: ReadonlyArray<OptionSelection>
): string | null {
  const groups = new Map<string, OptionGroupLike>();
  for (const group of item.options) {
    const key = trimmed(group.name);
    if (key && !groups.has(key)) groups.set(key, group);
  }

  const byGroup = new Map<string, string[]>();
  for (const selection of selections) {
    const groupName = trimmed(selection.groupName);
    const choiceName = trimmed(selection.choiceName);
    if (!groupName || !choiceName) {
      return `Choose a valid option for “${item.name}”.`;
    }
    const group = groups.get(groupName);
    if (!group) {
      return `“${groupName}” is not an option on “${item.name}”.`;
    }
    const known = group.choices.some((choice) => trimmed(choice.name) === choiceName);
    if (!known) {
      return `“${choiceName}” is not on the menu for “${item.name}”.`;
    }
    const list = byGroup.get(groupName) ?? [];
    list.push(choiceName);
    byGroup.set(groupName, list);
  }

  for (const group of groups.values()) {
    const key = trimmed(group.name);
    const picked = byGroup.get(key) ?? [];
    if (picked.length === 0) {
      if (group.required) {
        return group.choices.length === 0
          ? `“${group.name}” on “${item.name}” needs the owner's attention before it can be ordered.`
          : `Choose ${group.name} for “${item.name}”.`;
      }
      continue;
    }
    if (group.selection === "one" && picked.length > 1) {
      return `Choose only one ${group.name} for “${item.name}”.`;
    }
    if (!group.allowDuplicates && new Set(picked).size !== picked.length) {
      return `“${group.name}” allows each choice once for “${item.name}”.`;
    }
    const effective = group.allowDuplicates ? picked.length : new Set(picked).size;
    const floor = group.required ? Math.max(1, group.min) : group.min;
    if (effective < floor) {
      return `Choose at least ${floor} ${group.name} for “${item.name}”.`;
    }
    if (group.max !== null && effective > group.max) {
      return `Choose at most ${group.max} ${group.name} for “${item.name}”.`;
    }
  }
  return null;
}

/**
 * Sum the deltas of the picked choices, or null when any picked delta is
 * unknown. Callers add this to the dish/variant price; a null here makes the
 * whole line unpriced rather than guessing the extra.
 */
export function optionsPriceDelta(
  item: Pick<ItemWithOptions, "options">,
  selections: ReadonlyArray<OptionSelection>
): number | null {
  let total = 0;
  for (const selection of selections) {
    const group = item.options.find((candidate) => trimmed(candidate.name) === trimmed(selection.groupName));
    const choice = group?.choices.find(
      (candidate) => trimmed(candidate.name) === trimmed(selection.choiceName)
    );
    // Unknown names are a validation failure, not a price: the resolver
    // rejects them before pricing, so falling back to 0 here only guards
    // callers that price without validating first.
    if (!choice) continue;
    if (choice.priceDelta === null) return null;
    total += choice.priceDelta;
  }
  return total;
}

/** Dish/variant price plus the picked deltas; null when any part is unknown. */
export function priceWithOptions(
  basePrice: number | null,
  item: Pick<ItemWithOptions, "options">,
  selections: ReadonlyArray<OptionSelection>
): number | null {
  const delta = optionsPriceDelta(item, selections);
  if (basePrice === null || delta === null) return null;
  return basePrice + delta;
}

/**
 * Stamp the server-known deltas onto picks for *display* (cart rows, the
 * local-only flow). The diner sees the menu's own numbers; the send path
 * still re-resolves everything from the published snapshot, so these values
 * are never trusted as prices.
 */
export function withResolvedDeltas(
  item: Pick<ItemWithOptions, "options">,
  selections: ReadonlyArray<OptionSelection>
): { groupName: string; choiceName: string; priceDelta: number | null }[] {
  return normalizeSelections(selections).map((selection) => {
    const group = item.options.find(
      (candidate) => trimmed(candidate.name) === selection.groupName
    );
    const choice = group?.choices.find(
      (candidate) => trimmed(candidate.name) === selection.choiceName
    );
    return { ...selection, priceDelta: choice?.priceDelta ?? null };
  });
}

/**
 * Canonical order for a pick list: trimmed, empties dropped, sorted by
 * group then choice. Two carts holding the same picks in a different tap
 * order share one line instead of splitting into two.
 */
export function normalizeSelections(
  selections: ReadonlyArray<OptionSelection>
): OptionSelection[] {
  return selections
    .map((selection) => ({
      groupName: trimmed(selection.groupName),
      choiceName: trimmed(selection.choiceName),
    }))
    .filter((selection) => selection.groupName.length > 0 && selection.choiceName.length > 0)
    .sort((a, b) =>
      a.groupName === b.groupName
        ? a.choiceName.localeCompare(b.choiceName)
        : a.groupName.localeCompare(b.groupName)
    );
}

/** Stable cart/line key fragment for a normalized pick list. */
export function selectionsKey(selections: ReadonlyArray<OptionSelection>): string {
  return normalizeSelections(selections)
    .map((selection) => `${selection.groupName}›${selection.choiceName}`)
    .join("|");
}

/** Short diner-facing summary: "Bacon, Extra cheese". */
export function formatSelectionsSummary(
  selections: ReadonlyArray<OptionSelection>
): string {
  return normalizeSelections(selections)
    .map((selection) => selection.choiceName)
    .join(", ");
}

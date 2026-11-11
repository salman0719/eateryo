/**
 * Pure option-group rules for menu items (P1: sauces, toppings, add-ons).
 *
 * The canonical schema stores each group as name + min/max + priced choices;
 * everything here reads that shape without touching storage, so the editor,
 * the diner page, and the server resolver all enforce the same contract:
 * - min is the required switch: 0 means skippable, 1+ means pick that many;
 * - max 1 renders radios (single pick), anything else checkboxes;
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
  min: number;
  max: number | null;
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
      if (group.min > 0) {
        return group.choices.length === 0
          ? `“${group.name}” on “${item.name}” needs the owner's attention before it can be ordered.`
          : `Choose ${group.name} for “${item.name}”.`;
      }
      continue;
    }
    // Every choice may be picked once: the picker toggles presence, so a
    // repeat can only arrive from an API client and is always rejected.
    if (new Set(picked).size !== picked.length) {
      return `“${group.name}” allows each choice once for “${item.name}”.`;
    }
    const effective = new Set(picked).size;
    if (effective < group.min) {
      return group.min === group.max
        ? `Choose ${group.min} ${group.name} for “${item.name}”.`
        : `Choose at least ${group.min} ${group.name} for “${item.name}”.`;
    }
    if (group.max !== null && effective > group.max) {
      return `Choose at most ${group.max} ${group.name} for “${item.name}”.`;
    }
  }
  return null;
}

/**
 * Owner-facing configuration problems: rule shapes no diner can ever
 * satisfy, so the editor can warn before a typo silently closes a dish.
 * The server still rejects these at order time (defense in depth for API
 * orders) — this only moves the news earlier, to the person who can fix it.
 * Empty means the group is orderable.
 */ export function optionGroupConfigProblems(group: OptionGroupLike): string[] {
  const problems: string[] = [];
  if (group.max !== null && group.min > group.max) {
    problems.push(
      `Min ${group.min} is above Max ${group.max}: no pick count satisfies “${group.name}”.`
    );
  }
  if (group.min > group.choices.length) {
    problems.push(
      `Min ${group.min} needs more choices than “${group.name}” has (${group.choices.length}).`
    );
  }
  return problems;
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
    const group = item.options.find(
      (candidate) => trimmed(candidate.name) === trimmed(selection.groupName)
    );
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
    const group = item.options.find((candidate) => trimmed(candidate.name) === selection.groupName);
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
export function normalizeSelections(selections: ReadonlyArray<OptionSelection>): OptionSelection[] {
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
export function formatSelectionsSummary(selections: ReadonlyArray<OptionSelection>): string {
  return normalizeSelections(selections)
    .map((selection) => selection.choiceName)
    .join(", ");
}

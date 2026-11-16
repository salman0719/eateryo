/**
 * Dietary labels as tags — the one place that decides what a "label" is.
 *
 * A label is already `string[]` in the canonical schema, in extraction, in the
 * CSV writer (`join("; ")`) and in assistant proposals. The editor was the one
 * surface that flattened the array into a comma string and split it back on
 * `,`: that mangled any label containing a comma, and let `vegan, vegan`
 * commit two identical chips (duplicate React keys on the diner page).
 *
 * Nothing new is persisted. The suggestion list is a view over labels the
 * owner has already used, plus a small starter vocabulary so a first menu —
 * the one with no history to learn from — still offers something.
 */

/** Only ever suggestions: an owner still has to pick one per dish. We never
 * apply a dietary claim the menu does not show (see AGENTS.md). */
export const STARTER_DIETARY_LABELS = [
  "vegan",
  "vegetarian",
  "gluten-free",
  "dairy-free",
  "nut-free",
  "halal",
  "kosher",
  "spicy",
] as const;

/**
 * Built-in diner-facing explanations for the starter codes. Short on
 * purpose: they are tooltips and diner-page hints, not articles. Anything
 * else resolves from the menu's own `labelMeanings`, written in the picker.
 */
export const DIETARY_LABEL_MEANINGS: Record<(typeof STARTER_DIETARY_LABELS)[number], string> = {
  vegan: "No animal products.",
  vegetarian: "No meat or fish.",
  "gluten-free": "No wheat, barley or rye — ask about prep.",
  "dairy-free": "No milk, cheese or butter.",
  "nut-free": "No peanuts or tree nuts — ask about prep.",
  halal: "Prepared to halal standards — ask for details.",
  kosher: "Prepared to kosher standards — ask for details.",
  spicy: "Has heat — ask how much.",
};

/** The shape a suggestion list is derived from: a menu document, or anything
 * that carries categories of items. Structural, so this module needs no import
 * of the canonical schema and cannot drift with it. */
export interface DietaryLabelSource {
  categories: ReadonlyArray<{
    items: ReadonlyArray<{ dietaryLabels: readonly string[] }>;
  }>;
}

/** Collapse whitespace and trim. Labels come from photos, CSV and typing. */
export function cleanDietaryLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Trim, drop empties, and collapse case-insensitive duplicates keeping the
 * first spelling seen — `GF` and `gf` are one diet to a diner. Never used to
 * rewrite labels already stored: existing menus keep their text.
 */
export function dedupeDietaryLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of labels) {
    const label = cleanDietaryLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
  }
  return unique;
}

export function sameDietaryLabels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((label, index) => label === b[index]);
}

/** One vocabulary row: the label, kept in its first-seen spelling, and how
 * many dishes carry it (zero for unused starter codes). */
export interface DietaryLabelUsage {
  label: string;
  count: number;
}

/**
 * Every label these documents use with its usage count, most-used first then
 * alphabetical — plus the unused starter codes at zero, so the picker can
 * show the whole vocabulary with counts in one pass.
 */
export function dietaryLabelUsage(docs: readonly DietaryLabelSource[]): DietaryLabelUsage[] {
  const counts = new Map<string, DietaryLabelUsage>();
  for (const doc of docs) {
    for (const category of doc.categories) {
      for (const item of category.items) {
        for (const raw of item.dietaryLabels) {
          const label = cleanDietaryLabel(raw);
          if (!label) continue;
          const key = label.toLowerCase();
          const seen = counts.get(key);
          if (seen) seen.count += 1;
          else counts.set(key, { label, count: 1 });
        }
      }
    }
  }
  for (const label of STARTER_DIETARY_LABELS) {
    const key = label.toLowerCase();
    if (!counts.has(key)) counts.set(key, { label, count: 0 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Every label these documents already use, most-used first, then alphabetical
 * (so a steady menu keeps a stable order as the owner types). Labels already
 * in use are never repeated by the starter vocabulary.
 */
export function dietaryLabelVocabulary(docs: readonly DietaryLabelSource[]): string[] {
  return dietaryLabelUsage(docs).map((entry) => entry.label);
}

/** The shape meaning resolution reads: a menu document, or anything carrying
 * the per-menu custom meanings the picker writes. */
export interface DietaryLabelMeaningsSource {
  labelMeanings?: Readonly<Record<string, string>>;
}

/**
 * What a label means to a diner: the menu's own meaning first (custom
 * codes), then the built-in dictionary, else null — never invented.
 * Lookup is case-insensitive; stored meanings keep their own spelling.
 */
export function dietaryLabelMeaning(
  source: DietaryLabelMeaningsSource,
  code: string
): string | null {
  const cleaned = cleanDietaryLabel(code);
  if (!cleaned) return null;
  const own = source.labelMeanings;
  if (own) {
    const exact = own[cleaned];
    if (exact && cleanDietaryLabel(exact)) return cleanDietaryLabel(exact);
    const lower = cleaned.toLowerCase();
    for (const [key, value] of Object.entries(own)) {
      if (key.toLowerCase() === lower && value && cleanDietaryLabel(value)) {
        return cleanDietaryLabel(value);
      }
    }
  }
  return (DIETARY_LABEL_MEANINGS as Record<string, string>)[cleaned.toLowerCase()] ?? null;
}

interface SuggestOptions {
  /** Labels the field already holds — never offered back. */
  exclude?: readonly string[];
  /** What the owner is typing; empty offers the top of the list. */
  query?: string;
  limit?: number;
}

/**
 * Candidates for the row under the input: everything not already picked, and
 * while typing only what contains the query — with prefix matches first, so
 * `free` offers `free-range` above `gluten-free`.
 */
export function suggestDietaryLabels(
  vocabulary: readonly string[],
  options: SuggestOptions = {}
): string[] {
  const limit = options.limit ?? 8;
  const taken = new Set(
    (options.exclude ?? []).map((label) => cleanDietaryLabel(label).toLowerCase())
  );
  const query = cleanDietaryLabel(options.query ?? "").toLowerCase();

  const prefix: string[] = [];
  const rest: string[] = [];
  for (const raw of vocabulary) {
    const label = cleanDietaryLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (taken.has(key)) continue;
    if (query && !key.includes(query)) continue;
    (key.startsWith(query) ? prefix : rest).push(label);
  }
  return [...prefix, ...rest].slice(0, limit);
}

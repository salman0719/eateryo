/**
 * Reusable option-group templates ("Pizza sauces", "Toppings").
 *
 * A template is a stored definition; applying it copies the group onto
 * dishes. Dishes never reference templates, so editing a dish's copy never
 * disturbs the library or sibling dishes, and published snapshots need no
 * new resolution. "Update all dishes" is an explicit re-apply, never
 * automatic — automatic price propagation is a money bug waiting to happen.
 *
 * Matching is by exact group name, the same convention as variants and the
 * server-side pick resolver: extraction produces names, and the owner sees
 * both spellings side by side when they differ.
 */

import { nowIso } from "./menu-utils";
import {
  menuOptionSchema,
  type MenuDocument,
  type MenuItem,
  type MenuModifierTemplate,
} from "./schema";

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Where one dish lives, for usage lists and apply pickers. */
export interface TemplateDishRef {
  categoryId: string;
  categoryName: string;
  itemId: string;
  itemName: string;
}

function dishRef(categoryId: string, categoryName: string, item: MenuItem): TemplateDishRef {
  return { categoryId, categoryName, itemId: item.id, itemName: item.name };
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Template name must not be empty.");
  return trimmed;
}

function findTemplate(doc: MenuDocument, name: string): MenuModifierTemplate | undefined {
  return doc.modifierTemplates.find((template) => template.name === name);
}

function requireTemplate(doc: MenuDocument, name: string): MenuModifierTemplate {
  const template = findTemplate(doc, name);
  if (!template) throw new Error(`Unknown add-on set: ${name}`);
  return template;
}

/** Every dish in the document, in menu order. */
export function allDishes(doc: MenuDocument): TemplateDishRef[] {
  return doc.categories.flatMap((category) =>
    category.items.map((item) => dishRef(category.id, category.name, item))
  );
}

/** Dishes already carrying a group with the template's name. */
export function modifierTemplateUsage(doc: MenuDocument, name: string): TemplateDishRef[] {
  requireTemplate(doc, name);
  return doc.categories.flatMap((category) =>
    category.items
      .filter((item) => item.options.some((group) => group.name === name))
      .map((item) => dishRef(category.id, category.name, item))
  );
}

/** Dishes not yet carrying a group with the template's name: apply targets. */
export function dishesMissingTemplate(doc: MenuDocument, name: string): TemplateDishRef[] {
  requireTemplate(doc, name);
  const used = new Set(modifierTemplateUsage(doc, name).map((ref) => ref.itemId));
  return allDishes(doc).filter((ref) => !used.has(ref.itemId));
}

/**
 * Add a template to the library. Partial shapes (e.g. promoted from a
 * hand-built object) gain the contract defaults; duplicate names throw.
 */
export function addModifierTemplate(doc: MenuDocument, input: unknown): MenuDocument {
  const parsed = menuOptionSchema.parse(input);
  const name = requireName(parsed.name);
  if (findTemplate(doc, name)) throw new Error(`An add-on set named “${name}” already exists.`);
  const next = clone(doc);
  next.modifierTemplates.push({ ...parsed, name });
  next.updatedAt = nowIso();
  return next;
}

/**
 * Edit a template in the library. Dish copies already applied are untouched —
 * use `refreshDishesFromTemplate` to push the new definition out explicitly.
 * Renames collide with another template throw.
 */
export function updateModifierTemplate(
  doc: MenuDocument,
  name: string,
  patch: Partial<MenuModifierTemplate>
): MenuDocument {
  const current = requireTemplate(doc, name);
  const { name: nextName, ...rest } = patch;
  const merged = menuOptionSchema.parse({
    ...current,
    ...clone(rest),
    ...(nextName !== undefined ? { name: nextName } : {}),
  });
  merged.name = requireName(merged.name);
  if (merged.name !== name && findTemplate(doc, merged.name)) {
    throw new Error(`An add-on set named “${merged.name}” already exists.`);
  }
  const next = clone(doc);
  const index = next.modifierTemplates.findIndex((template) => template.name === name);
  next.modifierTemplates[index] = merged;
  next.updatedAt = nowIso();
  return next;
}

/**
 * Delete a template from the library. Copies already on dishes stay exactly
 * as they are — deleting a definition never rewrites a dish.
 */
export function deleteModifierTemplate(doc: MenuDocument, name: string): MenuDocument {
  requireTemplate(doc, name);
  const next = clone(doc);
  next.modifierTemplates = next.modifierTemplates.filter((template) => template.name !== name);
  next.updatedAt = nowIso();
  return next;
}

/**
 * Copy a template's group onto dishes (upsert by group name: a dish already
 * carrying the group gets the fresh definition, others gain it appended).
 *
 * Unknown template or item ids throw; an empty selection returns the
 * document unchanged.
 */
export function applyModifierTemplate(
  doc: MenuDocument,
  name: string,
  itemIds: ReadonlyArray<string>
): MenuDocument {
  if (itemIds.length === 0) return doc;
  const template = requireTemplate(doc, name);
  const next = clone(doc);
  const wanted = new Set(itemIds);
  const found = new Set<string>();
  for (const category of next.categories) {
    for (const item of category.items) {
      if (!wanted.has(item.id)) continue;
      found.add(item.id);
      const index = item.options.findIndex((group) => group.name === template.name);
      if (index === -1) item.options.push(clone(template));
      else item.options[index] = clone(template);
    }
  }
  for (const id of wanted) {
    if (!found.has(id)) throw new Error(`Unknown item id: ${id}`);
  }
  next.updatedAt = nowIso();
  return next;
}

/**
 * Push a template's current definition onto every dish already carrying a
 * group of that name. Returns the document and how many dishes changed —
 * dishes without the group are never touched, so the count is the feedback
 * ("Sauces updated on 14 dishes"). Dishes whose copy already matched still
 * count: the point is coverage, and comparing would hide renames.
 */
export function refreshDishesFromTemplate(
  doc: MenuDocument,
  name: string
): { doc: MenuDocument; updatedCount: number } {
  const template = requireTemplate(doc, name);
  const next = clone(doc);
  let updatedCount = 0;
  for (const category of next.categories) {
    for (const item of category.items) {
      const index = item.options.findIndex((group) => group.name === template.name);
      if (index === -1) continue;
      item.options[index] = clone(template);
      updatedCount += 1;
    }
  }
  next.updatedAt = nowIso();
  return { doc: next, updatedCount };
}

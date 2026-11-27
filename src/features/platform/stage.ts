/**
 * Account onboarding stage (B2) — pure derivation, no database.
 *
 * One account sits at exactly one of five stages: it signed up, it has a
 * café, it drafted a menu, it published one, or diners ordered from it.
 * "Onboarded" means a first order exists, because that is the only step
 * the servery can verify. The list page, the detail page and the overview
 * funnel all read this one function, so the three can never disagree.
 *
 * Counts come from the repo's page query (membership-scoped aggregates);
 * this module only decides which stage those counts describe.
 */

export const ACCOUNT_STAGES = ["signed_up", "cafe", "menu", "published", "ordering"] as const;

export type AccountStage = (typeof ACCOUNT_STAGES)[number];

/** Membership-scoped aggregates for one account (all counts ≥ 0). */
export interface AccountStageCounts {
  cafeCount: number;
  menuCount: number;
  /** Menus with a live pointer (`published_at` set). */
  liveCount: number;
  /** Orders placed against the account's cafés, all time. */
  orderCount: number;
}

function requireCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Account stage counts must be non-negative integers (${name}).`);
  }
}

/**
 * Furthest onboarding step the counts prove. Each step implies the ones
 * below it only through the product (a menu belongs to a café), so the
 * decision reads top-down: an order outranks everything, then a live
 * menu, then any menu, then any café — otherwise the account only signed
 * up. A deleted café leaves zeros behind, which correctly reads as
 * `signed_up`: the list never renders "unknown" as a stage.
 */
export function deriveAccountStage(counts: AccountStageCounts): AccountStage {
  requireCount(counts.cafeCount, "cafeCount");
  requireCount(counts.menuCount, "menuCount");
  requireCount(counts.liveCount, "liveCount");
  requireCount(counts.orderCount, "orderCount");
  if (counts.orderCount > 0) return "ordering";
  if (counts.liveCount > 0) return "published";
  if (counts.menuCount > 0) return "menu";
  if (counts.cafeCount > 0) return "cafe";
  return "signed_up";
}

/** Position on the five-step funnel (0-based), for progress rendering. */
export function stageIndex(stage: AccountStage): number {
  return ACCOUNT_STAGES.indexOf(stage);
}

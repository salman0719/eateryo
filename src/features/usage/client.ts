/**
 * Typed browser client for `/api/usage` (Step 11 — spend visibility).
 * Client-safe: HTTP + Zod only, no Drizzle and no server repo imports.
 */

import { z } from "zod";

import {
  assistantSpendSummarySchema,
  type AssistantSpendSummary,
} from "@/features/assistant/schema";
import { SyncError } from "@/features/menus/sync";

import { usageSummarySchema, type UsageSummary } from "./schema";

const usagePanelEnvelope = z.object({
  usage: usageSummarySchema,
  assistant: assistantSpendSummarySchema,
});

/** What the Settings spend card renders: both halves of one account's month. */
export interface UsagePanelData {
  usage: UsageSummary;
  assistant: AssistantSpendSummary;
}

/**
 * This account's extraction and assistant spend for the current UTC month.
 * Account-scoped: it takes no café and never 403s for a staff membership.
 */
export async function fetchUsage(): Promise<UsagePanelData> {
  let response: Response;
  try {
    response = await fetch("/api/usage", { cache: "no-store" });
  } catch {
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    throw new SyncError("unauthorized", "Sign in to see your usage.");
  }
  if (!response.ok) {
    throw new SyncError("unavailable", `Could not load usage (${response.status}).`);
  }

  try {
    return usagePanelEnvelope.parse(payload);
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent usage data this app could not understand. Try again in a moment."
    );
  }
}

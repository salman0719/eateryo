/**
 * Typed browser client for `/api/launch`. Client-safe: HTTP + Zod only.
 */

import { z } from "zod";

import { SyncError } from "@/features/menus/sync";

import { launchStatusSchema, type LaunchStatus } from "./schema";

const launchEnvelope = z.object({ launch: launchStatusSchema });

/**
 * One café's checklist. The caller passes the membership the shell is acting
 * in; the API answers 404 for a café on another account and 403 for a shift
 * (the checklist is the owner's, so a staff membership gets `forbidden` and
 * the surfaces render that decision instead of a retry that cannot work).
 */
export async function fetchLaunchStatus(restaurantId: string): Promise<LaunchStatus> {
  let response: Response;
  const query = new URLSearchParams({ restaurantId }).toString();
  try {
    response = await fetch(`/api/launch?${query}`, { cache: "no-store" });
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
    throw new SyncError("unauthorized", "Sign in to see your checklist.");
  }
  if (response.status === 403) {
    throw new SyncError("forbidden", "The checklist belongs to the café's owner.");
  }
  if (response.status === 404) {
    throw new SyncError("not_found", "That café is not on this account.");
  }
  if (!response.ok) {
    throw new SyncError("unavailable", "Could not load your checklist. Try again in a moment.");
  }

  try {
    return launchEnvelope.parse(payload).launch;
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent checklist data this app could not understand."
    );
  }
}

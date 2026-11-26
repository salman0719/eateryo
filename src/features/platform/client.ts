/**
 * Typed browser client for the admin read APIs (B2).
 * Client-safe: HTTP only, no Drizzle and no server repo imports.
 */

import { SyncError } from "@/features/menus/sync";

import {
  adminAccountDetailSchema,
  adminAccountsPageSchema,
  adminEventsPageSchema,
  type AdminAccountDetail,
  type AdminAccountsPage,
  type AdminEventsPage,
} from "./schema";

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toSyncError(status: number, operation: string): SyncError {
  if (status === 401) return new SyncError("unauthorized", "Sign in to continue.");
  if (status === 404) return new SyncError("not_found", "That page does not exist.");
  return new SyncError("unavailable", `Could not load ${operation} (${status}).`);
}

async function get<T>(path: string, operation: string, parse: (payload: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch {
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }
  const payload = await readJson(response);
  if (!response.ok) throw toSyncError(response.status, operation);
  try {
    return parse(payload);
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent data this app could not understand. Try again in a moment."
    );
  }
}

export interface AdminAccountsQueryInput {
  q?: string;
  filter?: string;
  sort?: string;
  cursor?: string;
}

/** One page of the accounts list. */
export async function fetchAdminAccounts(
  input: AdminAccountsQueryInput = {}
): Promise<AdminAccountsPage> {
  return get(`/api/admin/accounts${queryString(input)}`, "the accounts list", (payload) =>
    adminAccountsPageSchema.parse(payload)
  );
}

/** One account's detail. The id comes from the list row, never user input. */
export async function fetchAdminAccount(id: string): Promise<AdminAccountDetail> {
  return get(`/api/admin/accounts/${encodeURIComponent(id)}`, "that account", (payload) =>
    adminAccountDetailSchema.parse(payload)
  );
}

export interface AdminEventsQueryInput {
  action?: string;
  cursor?: string;
}

/** One page of the operator log. */
export async function fetchAdminEvents(
  input: AdminEventsQueryInput = {}
): Promise<AdminEventsPage> {
  return get(`/api/admin/events${queryString(input)}`, "the operator log", (payload) =>
    adminEventsPageSchema.parse(payload)
  );
}

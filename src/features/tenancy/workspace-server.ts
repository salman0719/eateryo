import type { RestaurantRole } from "@/lib/db/schema";

import type { Capability } from "./permissions";
import type { RestaurantWithAccess } from "./repo";

/**
 * The workspace block every café-scoped API response carries: which
 * membership answered, and what it may do.
 *
 * It rides on the data instead of a second `/api/restaurants` read, so a
 * screen can never pair one café's rows with another café's capabilities.
 * `capabilities` is the server's resolved answer for this membership — never
 * a union across the account.
 */
export interface WorkspacePayload {
  id: string;
  name: string;
  role: RestaurantRole;
  capabilities: Capability[];
}

export function workspacePayload(row: RestaurantWithAccess): WorkspacePayload {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    capabilities: row.access.capabilities,
  };
}

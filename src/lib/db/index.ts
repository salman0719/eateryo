import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleTcp } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema";

/**
 * Server-side Drizzle client.
 *
 * Production and Neon-hosted URLs keep the Neon HTTP driver. A plain
 * `postgresql://` URL pointing at any other host (e.g. a local docker
 * postgres for branch development) cannot be spoken by the Neon HTTP
 * driver, so it gets a short-lived-per-process node-postgres pool instead.
 * Both are the same pg dialect over the same generated schema.
 *
 * Created lazily so importing this module is safe without `DATABASE_URL`
 * (next build, vitest, and the anonymous local-first flow must not need it).
 * Never import this from client components — it is server-only.
 */
export function createDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The server DB is optional (signed-out = local mode); " +
        "set DATABASE_URL in .env.local / Vercel env vars to enable accounts."
    );
  }
  if (isDirectTcpPostgres(url)) {
    return drizzleTcp(new Pool({ connectionString: url }), { schema });
  }
  return drizzleNeon(neon(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** True for a TCP postgres URL the Neon HTTP driver cannot speak. */
function isDirectTcpPostgres(url: string): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  return !/\.neon\.(tech|build)$/i.test(hostname);
}

let cachedUrl: string | undefined;
let cachedDb: Db | undefined;

/** Shared lazy singleton for app code (per-process). */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!cachedDb || cachedUrl !== url) {
    cachedDb = createDb(url);
    cachedUrl = url;
  }
  return cachedDb;
}

export { schema };

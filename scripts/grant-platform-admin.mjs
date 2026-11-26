#!/usr/bin/env node
/**
 * Grant, revoke, or list platform operators in the dev database by email.
 *
 * The only way to create the first operators (B0): there is no in-app
 * “make me admin” path. Talks to the same Neon database the app uses
 * (DATABASE_URL), with parameterised SQL only. Revocation keeps the row
 * with revoked_at set — the user's own café access is untouched.
 *
 * Usage (DATABASE_URL is read from .env.local via the npm script):
 *   npm run admin:platform -- list
 *   npm run admin:platform -- grant <email> [--by <granter email>]
 *   npm run admin:platform -- revoke <email>
 *
 * Exit codes: 0 success, 1 not found / refused, 2 usage or missing config.
 */

import { neon } from "@neondatabase/serverless";

const USAGE = `Usage:
  npm run admin:platform -- list
  npm run admin:platform -- grant <email> [--by <granter email>]
  npm run admin:platform -- revoke <email>`;

function fail(message, exitCode) {
  console.error(message);
  process.exit(exitCode);
}

async function findUserId(sql, email) {
  const rows = await sql`select id, email from "user" where email = ${email}`;
  return rows[0] ?? null;
}

async function listCommand(sql) {
  const rows = await sql`
    select u.email, p.role, p.granted_by, p.granted_at, p.revoked_at
    from platform_admin p
    join "user" u on u.id = p.user_id
    order by p.granted_at
  `;
  if (rows.length === 0) {
    console.log("No platform operators in this database.");
    return;
  }
  for (const row of rows) {
    const state = row.revoked_at ? `revoked ${row.revoked_at.toISOString()}` : "active";
    console.log(`${row.email}  ${row.role}  ${state}  (granted ${row.granted_at.toISOString()})`);
  }
}

async function grantCommand(sql, rest) {
  const email = rest[0];
  if (!email) fail(`Missing <email> for grant.\n\n${USAGE}`, 2);
  const byIndex = rest.indexOf("--by");
  const grantedBy = byIndex === -1 ? null : rest[byIndex + 1] ?? null;
  if (byIndex !== -1 && !grantedBy) fail(`Missing address after --by.\n\n${USAGE}`, 2);

  const account = await findUserId(sql, email);
  if (!account) fail(`No account with email ${email}. They sign in (link-only) first.`, 1);

  const existing = await sql`select revoked_at from platform_admin where user_id = ${account.id}`;
  if (existing.length === 0) {
    await sql`
      insert into platform_admin (id, user_id, role, granted_by)
      values (gen_random_uuid(), ${account.id}, 'operator', ${grantedBy})
    `;
    console.log(`Granted operator access to ${email}.`);
    return;
  }
  if (existing[0].revoked_at !== null) {
    await sql`
      update platform_admin
      set revoked_at = null, role = 'operator', granted_by = ${grantedBy}
      where user_id = ${account.id}
    `;
    console.log(`Restored operator access for ${email}.`);
    return;
  }
  console.log(`${email} is already an active operator.`);
}

async function revokeCommand(sql, rest) {
  const email = rest[0];
  if (!email) fail(`Missing <email> for revoke.\n\n${USAGE}`, 2);

  const account = await findUserId(sql, email);
  if (!account) fail(`No account with email ${email}.`, 1);

  const updated = await sql`
    update platform_admin
    set revoked_at = now()
    where user_id = ${account.id} and revoked_at is null
    returning user_id
  `;
  if (updated.length === 0) fail(`${email} holds no active operator grant.`, 1);
  console.log(`Revoked operator access for ${email}. Their cafés are untouched.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("DATABASE_URL is not set. Put it in .env.local (the npm script loads it) and retry.", 2);
  }
  const sql = neon(url);

  if (command === "list") return listCommand(sql);
  if (command === "grant") return grantCommand(sql, rest);
  if (command === "revoke") return revokeCommand(sql, rest);
  fail(`Unknown command “${command}”.\n\n${USAGE}`, 2);
}

try {
  await main();
} catch (error) {
  fail(`grant-platform-admin failed: ${error instanceof Error ? error.message : String(error)}`, 1);
}

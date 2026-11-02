#!/usr/bin/env node
/**
 * Reclaim UploadThing storage from dish photos nothing points at any more.
 *
 * Photos are uploaded before the menu is saved and are never deleted when an
 * owner replaces or removes one, because a published revision may still be
 * serving the old file (see `menuItemImageSchema`). That is the right default
 * for diners, but it leaves storage behind: an upload whose save failed, or one
 * abandoned mid-edit, is referenced by nothing and would otherwise sit there
 * forever.
 *
 * This script finds exactly those files and nothing else. A file is deleted
 * only when it carries this feature's naming (`dish-…-display.webp` and
 * `dish-…-thumb.webp`), the host reports it as fully uploaded, no `menu` row
 * and no `menu_revision` row references its key, and it is older than the
 * retention window (30 days by default). Every other file is listed with the
 * reason it was kept.
 *
 * It is a dry run unless told otherwise, and deleting needs a second flag:
 *
 *   npm run photos:sweep                      # show what would be deleted
 *   npm run photos:sweep -- --days 14         # narrower window
 *   npm run photos:sweep -- --delete --yes    # delete them
 *
 * Exit codes: 0 success, 1 a delete or storage read failed, 2 usage or config.
 */

import { neon } from "@neondatabase/serverless";
import { UTApi } from "uploadthing/server";

import {
  chunk,
  collectPhotoKeys,
  DEFAULT_RETENTION_DAYS,
  planPhotoSweep,
} from "./lib/dish-photo-sweep.mjs";

const USAGE = `Usage:
  npm run photos:sweep                      # dry run (default)
  npm run photos:sweep -- --days 14         # retention window in days
  npm run photos:sweep -- --delete --yes    # actually delete

Options:
  --days <n>        Keep unreferenced photos uploaded in the last n days.
                    Default ${DEFAULT_RETENTION_DAYS}. 0 means "ignore age".
  --delete          Delete the files the plan lists.
  --yes             Required together with --delete; there is no undo.
  --allow-empty-db  Proceed when the database holds no menus at all. Without
                    it the script stops, because an empty database usually
                    means a wrong DATABASE_URL, and every photo would look
                    unreferenced.
  --help            Show this message.`;

const PAGE_SIZE = 500;

/**
 * @param {string} message
 * @param {number} exitCode
 * @returns {never}
 */
function fail(message, exitCode) {
  console.error(message);
  process.exit(exitCode);
}

/**
 * @param {string[]} argv
 * @returns {{ days: number, delete: boolean, yes: boolean, allowEmptyDb: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const options = {
    days: DEFAULT_RETENTION_DAYS,
    delete: false,
    yes: false,
    allowEmptyDb: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--delete") options.delete = true;
    else if (argument === "--yes") options.yes = true;
    else if (argument === "--allow-empty-db") options.allowEmptyDb = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--days") {
      const value = argv[index + 1];
      index += 1;
      if (!/^\d+$/.test(value ?? "")) fail(`--days needs a whole number.\n\n${USAGE}`, 2);
      options.days = Number(value);
    } else if (argument.startsWith("--days=")) {
      const value = argument.slice("--days=".length);
      if (!/^\d+$/.test(value)) fail(`--days needs a whole number.\n\n${USAGE}`, 2);
      options.days = Number(value);
    } else {
      fail(`Unknown option “${argument}”.\n\n${USAGE}`, 2);
    }
  }

  return options;
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @param {number} epochMs */
function formatDate(epochMs) {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Every file in the file host's bucket, following pagination to the end.
 * @param {UTApi} utapi
 */
async function listAllFiles(utapi) {
  /** @type {Awaited<ReturnType<UTApi["listFiles"]>>["files"][number][]} */
  const files = [];
  let offset = 0;
  for (;;) {
    const page = await utapi.listFiles({ limit: PAGE_SIZE, offset });
    files.push(...page.files);
    if (!page.hasMore || page.files.length === 0) break;
    offset += page.files.length;
  }
  return files;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL is not set. Put it in .env.local (the npm script loads it) and retry.", 2);
  }
  if (!process.env.UPLOADTHING_TOKEN) {
    fail(
      "UPLOADTHING_TOKEN is not set. Photo storage is not configured, so there is nothing to sweep.",
      2
    );
  }
  if (options.delete && !options.yes) {
    fail(
      "Refusing to delete anything without --yes. Deleted files cannot be restored " +
        "and a published menu that still points at one would show a broken photo.\n" +
        "Run the dry run first, then: npm run photos:sweep -- --delete --yes",
      2
    );
  }

  const sql = neon(databaseUrl);
  const utapi = new UTApi();

  // Read the references before the file list: if this fails, nothing below can
  // mistake "no keys" for "nothing references anything".
  const menus = await sql`select id, doc from menu`;
  const revisions = await sql`select id, doc from menu_revision`;

  if (menus.length === 0 && revisions.length === 0 && !options.allowEmptyDb) {
    fail(
      "This database holds no menus or published revisions, so every photo looks " +
        "unreferenced. That usually means DATABASE_URL points at the wrong place; " +
        "refusing to continue. Re-run with --allow-empty-db if it really is empty.",
      2
    );
  }

  const referencedKeys = collectPhotoKeys([
    ...menus.map((row) => row.doc),
    ...revisions.map((row) => row.doc),
  ]);

  const files = await listAllFiles(utapi);
  const plan = planPhotoSweep({
    files,
    referencedKeys,
    now: new Date(),
    retentionDays: options.days,
  });
  const dishPhotos = files.length - plan.foreign.length;

  console.log(`Dish photo sweep — ${options.delete ? "DELETING" : "dry run"}`);
  console.log(
    `  database: ${menus.length} menu(s), ${revisions.length} published revision(s), ` +
      `${referencedKeys.size} photo key(s) referenced`
  );
  console.log(`  storage: ${files.length} file(s), of which ${dishPhotos} are dish photos`);
  console.log(
    `  retention: unreferenced photos uploaded on or before ${formatDate(plan.cutoff.getTime())} ` +
      `(${options.days} day(s))`
  );
  console.log(
    `  kept: ${plan.referenced.length} referenced, ${plan.tooNew.length} inside the window, ` +
      `${plan.notUploaded.length} not fully uploaded`
  );
  console.log(`  left alone: ${plan.foreign.length} file(s) that are not dish photos`);
  console.log(
    `  ${options.delete ? "deleting" : "would delete"}: ${plan.deletable.length} file(s), ` +
      formatBytes(plan.deletableBytes)
  );

  if (plan.foreign.length > 0) {
    console.log("\nNot dish photos (never touched):");
    for (const file of plan.foreign) console.log(`  ${file.name}  (${file.key})`);
  }

  if (plan.deletable.length === 0) {
    console.log("\nNothing to reclaim.");
    return;
  }

  console.log("\nUnreferenced dish photos past the retention window:");
  for (const file of plan.deletable) {
    console.log(
      `  ${file.name}  ${formatBytes(file.size)}  uploaded ${formatDate(file.uploadedAt)}  ${file.key}`
    );
  }

  if (!options.delete) {
    console.log(
      `\nNothing was deleted. To delete these ${plan.deletable.length} file(s):\n` +
        "  npm run photos:sweep -- --delete --yes"
    );
    return;
  }

  let deleted = 0;
  for (const batch of chunk(plan.deletable.map((file) => file.key))) {
    try {
      const result = await utapi.deleteFiles(batch);
      deleted += result.deletedCount;
      if (!result.success) {
        console.error(`A delete call for ${batch.length} file(s) reported failure.`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(
        `A delete call for ${batch.length} file(s) failed after ${deleted} file(s) were deleted: ` +
          (error instanceof Error ? error.message : String(error))
      );
      process.exitCode = 1;
      break;
    }
  }

  console.log(`\nDeleted ${deleted} of ${plan.deletable.length} file(s) from photo storage.`);
}

try {
  await main();
} catch (error) {
  fail(`dish photo sweep failed: ${error instanceof Error ? error.message : String(error)}`, 1);
}

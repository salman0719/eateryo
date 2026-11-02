/**
 * Planning rules for the dish-photo storage sweep. Pure: no network, no
 * database, no filesystem, so the part that decides what may be deleted is
 * unit-tested (`tests/dish-photo-sweep.test.ts`) instead of trusted.
 *
 * `scripts/cleanup-dish-photos.mjs` supplies the two inputs — every stored
 * file, and every document that could point at one — and carries out the plan.
 */

/**
 * The names `src/features/item-images/prepare.ts` gives the two copies of a
 * photo: `dish-<base36 stamp>-<random>-display.webp` and `…-thumb.webp`.
 * Anything else in the bucket was not uploaded by this feature, so it is never
 * considered no matter what the database says.
 */
export const DISH_PHOTO_NAME = /^dish-[a-z0-9]+-[a-z0-9]+-(?:display|thumb)\.(?:webp|png|jpg|img)$/;

/**
 * How long an unreferenced dish photo is kept before it may be swept.
 *
 * A photo is uploaded *before* the menu document is saved, so the window has to
 * outlive an owner attaching a photo and then taking their time over a price.
 * Thirty days also covers the case of an upload that succeeded while the save
 * failed: the photo is reclaimable, but not before anyone has had a chance to
 * notice and retry.
 */
export const DEFAULT_RETENTION_DAYS = 30;

/** UploadThing accepts a limited number of keys in one delete call. */
export const DELETE_CHUNK_SIZE = 100;

/**
 * A file as the file host reports it.
 * @typedef {object} StoredFile
 * @property {string} key
 * @property {string} name
 * @property {number} size
 * @property {number} uploadedAt Epoch milliseconds.
 * @property {string} [status]
 */

/**
 * @typedef {object} SweepPlan
 * @property {StoredFile[]} deletable Unreferenced, old enough, and ours.
 * @property {StoredFile[]} referenced Still pointed at by a menu or revision.
 * @property {StoredFile[]} tooNew Unreferenced but inside the window.
 * @property {StoredFile[]} foreign Not a dish photo: always left alone.
 * @property {StoredFile[]} notUploaded Not in a settled "Uploaded" state.
 * @property {Date} cutoff Files uploaded after this instant are too new.
 * @property {number} deletableBytes Total size of `deletable`, for the report.
 */

/**
 * True when a stored file is one of the copies this feature uploads.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isDishPhotoName(name) {
  return typeof name === "string" && DISH_PHOTO_NAME.test(name);
}

/**
 * Every photo key referenced anywhere in the given documents, thumbnails
 * included.
 *
 * A stored photo is recognised by its shape — a string `key` beside a string
 * `url` — rather than by its position, so a document that nests or moves its
 * categories differently still protects the photos it uses. Reads never trust
 * the shape of a stored document, so this must not either.
 *
 * @param {unknown} documents
 * @returns {Set<string>}
 */
export function collectPhotoKeys(documents) {
  /** @type {Set<string>} */
  const keys = new Set();
  /** @param {unknown} value */
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (value);
    if (typeof record.key === "string" && typeof record.url === "string") {
      keys.add(record.key);
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(documents);
  return keys;
}

/**
 * Sort every stored file into "may be deleted" and the reasons to keep it.
 *
 * A file is deletable only when all four hold: it carries this feature's
 * naming, the host reports it as fully uploaded, no menu document or published
 * revision references its key, and it is older than the retention window.
 * Everything else is kept and reported, so an operator can see why.
 *
 * @param {object} input
 * @param {StoredFile[]} input.files
 * @param {Set<string>} input.referencedKeys
 * @param {Date} input.now
 * @param {number} [input.retentionDays]
 * @returns {SweepPlan}
 */
export function planPhotoSweep({
  files,
  referencedKeys,
  now,
  retentionDays = DEFAULT_RETENTION_DAYS,
}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("planPhotoSweep needs a valid `now` Date.");
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new TypeError("planPhotoSweep needs a non-negative retention window.");
  }

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffMs = cutoff.getTime();

  /** @type {SweepPlan} */
  const plan = {
    deletable: [],
    referenced: [],
    tooNew: [],
    foreign: [],
    notUploaded: [],
    cutoff,
    deletableBytes: 0,
  };

  for (const file of files) {
    if (!isDishPhotoName(file.name)) {
      plan.foreign.push(file);
    } else if (file.status && file.status !== "Uploaded") {
      // A half-finished or already-scheduled object is the host's to settle.
      plan.notUploaded.push(file);
    } else if (referencedKeys.has(file.key)) {
      plan.referenced.push(file);
    } else if (!(file.uploadedAt <= cutoffMs)) {
      plan.tooNew.push(file);
    } else {
      plan.deletable.push(file);
    }
  }

  plan.deletableBytes = plan.deletable.reduce(
    (sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0),
    0
  );
  return plan;
}

/**
 * Split a list into batches small enough for one delete call.
 * @template T
 * @param {T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function chunk(items, size = DELETE_CHUNK_SIZE) {
  if (!Number.isInteger(size) || size < 1) {
    throw new TypeError("chunk needs a positive integer size.");
  }
  /** @type {T[][]} */
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

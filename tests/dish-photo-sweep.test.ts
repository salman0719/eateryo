import { describe, expect, test } from "vitest";

import {
  chunk,
  collectPhotoKeys,
  DEFAULT_RETENTION_DAYS,
  DELETE_CHUNK_SIZE,
  isDishPhotoName,
  planPhotoSweep,
} from "../scripts/lib/dish-photo-sweep.mjs";

/**
 * The sweep is the only code in this repo that deletes a diner-visible
 * asset, so its rules are tested directly: naming, reference discovery, the
 * retention window, and the batching used for the delete calls.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-31T12:00:00.000Z");

type StoredFileShape = {
  key: string;
  name: string;
  size: number;
  uploadedAt: number;
  status?: string;
};

/** A stored file shaped like the host reports it. */
function storedFile(overrides: Partial<StoredFileShape> = {}): StoredFileShape {
  return {
    key: `key-${overrides.name}`,
    name: "dish-mvv125t9-8zbu4w-display.webp",
    size: 10_000,
    uploadedAt: NOW.getTime() - 60 * DAY_MS,
    status: "Uploaded",
    ...overrides,
  };
}

describe("isDishPhotoName", () => {
  test("accepts the names prepare.ts generates", () => {
    // Taken from a real upload: dish-<base36 stamp>-<random>-<variant>.<ext>
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-display.webp")).toBe(true);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-thumb.webp")).toBe(true);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-display.png")).toBe(true);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-display.jpg")).toBe(true);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-display.img")).toBe(true);
  });

  test("rejects anything this feature did not upload", () => {
    expect(isDishPhotoName("menu-page.jpg")).toBe(false);
    expect(isDishPhotoName("2e0fdb64_image.jpg")).toBe(false);
    // Missing the random segment, wrong case, unknown extension, wrong variant.
    expect(isDishPhotoName("dish-mvv125t9-display.webp")).toBe(false);
    expect(isDishPhotoName("dish-MVV125T9-8ZBU4W-display.webp")).toBe(false);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-display.gif")).toBe(false);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-original.webp")).toBe(false);
    expect(isDishPhotoName("dish-mvv125t9-8zbu4w-display.webp.exe")).toBe(false);
    expect(isDishPhotoName("dish-../../secret-display.webp")).toBe(false);
  });

  test("rejects values that are not names", () => {
    expect(isDishPhotoName(undefined)).toBe(false);
    expect(isDishPhotoName(null)).toBe(false);
    expect(isDishPhotoName(42)).toBe(false);
  });
});

describe("collectPhotoKeys", () => {
  test("finds the display copy and the thumbnail of a menu item", () => {
    const doc = {
      categories: [
        {
          items: [
            { id: "a", name: "Espresso", image: { key: "display-key", url: "https://cdn/x" } },
            {
              id: "b",
              name: "Latte",
              image: {
                key: "second-display",
                url: "https://cdn/y",
                thumb: { key: "second-thumb", url: "https://cdn/z" },
              },
            },
            { id: "c", name: "Toast" },
          ],
        },
      ],
    };

    expect([...collectPhotoKeys([doc])].sort()).toEqual([
      "display-key",
      "second-display",
      "second-thumb",
    ]);
  });

  test("accepts a bare document as well as a list of them", () => {
    const doc = { image: { key: "one", url: "https://cdn/1" } };
    expect([...collectPhotoKeys(doc)]).toEqual(["one"]);
  });

  test("ignores an object that has a key but no URL", () => {
    const doc = { id: "item", key: "not-a-photo", nested: [{ key: "still-not", value: 1 }] };
    expect(collectPhotoKeys([doc]).size).toBe(0);
  });

  test("treats anything shaped like a stored photo as a reference", () => {
    // Deliberately conservative: a false positive only keeps a file that could
    // have been reclaimed, while a false negative would delete a photo some
    // document still points at.
    const doc = { id: "item", key: "looks-like-a-photo", url: "https://example.test/item" };
    expect([...collectPhotoKeys([doc])]).toEqual(["looks-like-a-photo"]);
  });

  test("survives empty and malformed documents", () => {
    expect(collectPhotoKeys([]).size).toBe(0);
    expect(collectPhotoKeys([null, undefined, "text", 7]).size).toBe(0);
  });
});

describe("planPhotoSweep", () => {
  test("sorts each file into exactly one bucket", () => {
    const files = [
      storedFile({ name: "dish-aaa-111-display.webp", key: "referenced" }),
      storedFile({
        name: "dish-aaa-111-thumb.webp",
        key: "too-new",
        uploadedAt: NOW.getTime() - DAY_MS,
      }),
      storedFile({ name: "dish-bbb-222-display.webp", key: "deletable", size: 2048 }),
      storedFile({ name: "holiday-menu.png", key: "foreign" }),
      storedFile({
        name: "dish-ccc-333-display.webp",
        key: "unsettled",
        status: "Deletion Pending",
      }),
    ];

    const plan = planPhotoSweep({
      files,
      referencedKeys: new Set(["referenced"]),
      now: NOW,
    });

    expect(plan.deletable.map((file) => file.key)).toEqual(["deletable"]);
    expect(plan.referenced.map((file) => file.key)).toEqual(["referenced"]);
    expect(plan.tooNew.map((file) => file.key)).toEqual(["too-new"]);
    expect(plan.foreign.map((file) => file.key)).toEqual(["foreign"]);
    expect(plan.notUploaded.map((file) => file.key)).toEqual(["unsettled"]);
    expect(plan.deletableBytes).toBe(2048);
    expect(plan.cutoff.getTime()).toBe(NOW.getTime() - DEFAULT_RETENTION_DAYS * DAY_MS);
  });

  test("keeps a file uploaded exactly at the cutoff for one more day", () => {
    const cutoff = NOW.getTime() - 30 * DAY_MS;
    const plan = planPhotoSweep({
      files: [
        storedFile({ key: "at-cutoff", uploadedAt: cutoff }),
        storedFile({ key: "one-ms-newer", uploadedAt: cutoff + 1 }),
      ],
      referencedKeys: new Set(),
      now: NOW,
    });

    expect(plan.deletable.map((file) => file.key)).toEqual(["at-cutoff"]);
    expect(plan.tooNew.map((file) => file.key)).toEqual(["one-ms-newer"]);
  });

  test("a zero-day window reclaims every unreferenced photo", () => {
    const plan = planPhotoSweep({
      files: [storedFile({ key: "fresh", uploadedAt: NOW.getTime() - 1000 })],
      referencedKeys: new Set(),
      now: NOW,
      retentionDays: 0,
    });
    expect(plan.deletable.map((file) => file.key)).toEqual(["fresh"]);
  });

  test("never reports the same file twice", () => {
    const files = [
      storedFile({ name: "dish-aaa-111-display.webp", key: "one" }),
      storedFile({ name: "dish-aaa-111-display.webp", key: "one" }),
    ];
    const plan = planPhotoSweep({ files, referencedKeys: new Set(), now: NOW });
    const reported = [
      plan.deletable.length,
      plan.referenced.length,
      plan.tooNew.length,
      plan.foreign.length,
      plan.notUploaded.length,
    ].reduce((sum, count) => sum + count, 0);
    expect(reported).toBe(files.length);
  });

  test("refuses input it cannot reason about", () => {
    expect(() =>
      planPhotoSweep({ files: [], referencedKeys: new Set(), now: new Date("nope") })
    ).toThrow(TypeError);
    expect(() =>
      planPhotoSweep({ files: [], referencedKeys: new Set(), now: NOW, retentionDays: -1 })
    ).toThrow(TypeError);
  });
});

describe("chunk", () => {
  test("splits keys into delete-sized batches", () => {
    const keys = Array.from({ length: 250 }, (_, index) => `key-${index}`);
    const batches = chunk(keys);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches[0]?.[0]).toBe("key-0");
    expect(batches.flat()).toEqual(keys);
    expect(DELETE_CHUNK_SIZE).toBe(100);
  });

  test("returns nothing for an empty list", () => {
    expect(chunk([])).toEqual([]);
  });

  test("rejects a batch size that is not a positive integer", () => {
    expect(() => chunk(["a"], 0)).toThrow(TypeError);
    expect(() => chunk(["a"], 1.5)).toThrow(TypeError);
  });
});

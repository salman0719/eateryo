import { afterEach, describe, expect, it, vi } from "vitest";

import { publishMenuWithSetup } from "@/features/publishing/setup-client";
import { SyncError } from "@/features/menus/sync";

const publication = {
  menuId: "menu-1",
  restaurantId: "r-1",
  isLive: true,
  publishedAt: "2026-10-24T10:00:00.000Z",
  liveRevisionId: "rev-1",
  sourceUpdatedAt: "2026-10-24T09:59:00.000Z",
  hasUnpublishedChanges: false,
};

const success = {
  publication,
  restaurant: { id: "r-1", name: "Sunny Side Café" },
  created: { restaurant: true, menu: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishMenuWithSetup", () => {
  it("POSTs the form and decodes the live result", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(success));
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishMenuWithSetup("menu id/1", {
      slug: "lunch",
      restaurantName: "Sunny Side Café",
    });

    expect(result.publication.isLive).toBe(true);
    expect(result.created).toEqual({ restaurant: true, menu: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/menus/menu%20id%2F1/publish-setup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      slug: "lunch",
      restaurantName: "Sunny Side Café",
    });
  });

  it.each([
    [401, "unauthorized", "unauthorized"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [400, "invalid_body", "invalid"],
    [409, "slug_taken", "slug_taken"],
    [503, "server_db_unavailable", "unavailable"],
  ] as const)("maps %s %s to %s", async (status, serverCode, clientCode) => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ error: { code: serverCode, message: "nope" } }, status)
    );

    await expect(
      publishMenuWithSetup("menu-1", { restaurantName: "Café" })
    ).rejects.toMatchObject({ code: clientCode });
  });

  it("maps a network failure to unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const error = await publishMenuWithSetup("menu-1", {
      restaurantName: "Café",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).code).toBe("unavailable");
  });

  it("rejects a malformed success payload", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ unexpected: true }));

    await expect(
      publishMenuWithSetup("menu-1", { restaurantName: "Café" })
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

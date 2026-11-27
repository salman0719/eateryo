import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteRestaurantForOwner,
  getRestaurantForUser,
  renameRestaurantForOwner,
  setRestaurantBrandAssetsForOwner,
  setRestaurantDinerThemeForOwner,
} from "@/features/tenancy/repo";
import { brandAssetImageSchema } from "@/features/brand-assets/schema";
import { dinerThemeSchema } from "@/features/diner-theme/schema";
import { AccountStateError, assertAccountActive } from "@/lib/auth/account-state";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * PATCH  /api/restaurants/[restaurantId] — owner-only rename and/or brand
 *   assets (logo, cover). Each field is independent: an absent key is left
 *   alone, an explicit null clears that brand slot.
 * DELETE /api/restaurants/[restaurantId] — owner-only delete. Memberships,
 *   menus, published pages and orders cascade in the database, so the UI
 *   must warn about that before calling.
 * Anonymous visitors get 401; members without the owner role get 403;
 * everyone else gets 404 so ids cannot be probed across accounts (same
 * rule as /api/menus/[menuId]). Error shape: { error: { code, message } }.
 */

const updateBody = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120).optional(),
    logo: brandAssetImageSchema.nullable().optional(),
    cover: brandAssetImageSchema.nullable().optional(),
    dinerTheme: dinerThemeSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.logo !== undefined ||
      value.cover !== undefined ||
      value.dinerTheme !== undefined,
    "Nothing to update."
  );

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Session guard shared by both handlers. */
async function requireUser(): Promise<string | NextResponse> {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return errorResponse("unauthorized", "Sign in to continue.", 401);
    }
    return userId;
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
}

/**
 * Why an owner-only mutation refused: staff (and other members) get 403,
 * while outsiders get 404 — a foreign id must not be distinguishable from
 * a missing one.
 */
async function refusalResponse(
  userId: string,
  restaurantId: string,
  memberMessage: string
): Promise<NextResponse> {
  const member = await getRestaurantForUser(getDb(), userId, restaurantId);
  return member
    ? errorResponse("forbidden", memberMessage, 403)
    : errorResponse("not_found", "That restaurant does not exist.", 404);
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = updateBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    await assertAccountActive(getDb(), userId);
    const db = getDb();
    const { name, logo, cover, dinerTheme } = parsed.data;
    // When no rename is asked for, any member reads the row so a staff
    // writer still lands on the 403 branch below instead of a 404.
    let restaurant =
      name !== undefined
        ? await renameRestaurantForOwner(db, userId, restaurantId, name)
        : await getRestaurantForUser(db, userId, restaurantId);
    if (!restaurant) {
      return refusalResponse(
        userId,
        restaurantId,
        name !== undefined
          ? "Only an owner can rename this restaurant."
          : "Only an owner can change this restaurant's brand."
      );
    }
    if (logo !== undefined || cover !== undefined) {
      restaurant = await setRestaurantBrandAssetsForOwner(db, userId, restaurantId, {
        logo,
        cover,
      });
      if (!restaurant) {
        return refusalResponse(
          userId,
          restaurantId,
          "Only an owner can change this restaurant's brand."
        );
      }
    }
    if (dinerTheme !== undefined) {
      try {
        restaurant = await setRestaurantDinerThemeForOwner(db, userId, restaurantId, dinerTheme);
      } catch {
        return errorResponse("invalid_body", "Unknown diner theme.", 400);
      }
      if (!restaurant) {
        return refusalResponse(
          userId,
          restaurantId,
          "Only an owner can change this restaurant's diner look."
        );
      }
    }
    return noStore(NextResponse.json({ restaurant }));
  } catch (error) {
    if (error instanceof AccountStateError)
      return errorResponse("account_suspended", error.message, 403);
    return errorResponse(
      "server_db_unavailable",
      "Could not update the restaurant. Try again.",
      503
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  try {
    await assertAccountActive(getDb(), userId);
    const deleted = await deleteRestaurantForOwner(getDb(), userId, restaurantId);
    if (!deleted) {
      return refusalResponse(userId, restaurantId, "Only an owner can delete this restaurant.");
    }
    return noStore(new NextResponse(null, { status: 204 }));
  } catch (error) {
    if (error instanceof AccountStateError)
      return errorResponse("account_suspended", error.message, 403);
    return errorResponse(
      "server_db_unavailable",
      "Could not delete the restaurant. Try again.",
      503
    );
  }
}

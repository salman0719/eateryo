import { NextResponse, type NextRequest } from "next/server";
import { createRouteHandler } from "uploadthing/next";

import { ourFileRouter } from "./core";

/**
 * `POST /api/uploadthing` — the one endpoint the browser uploads dish photos
 * to (GET serves the route config, so the client knows the size/type limits).
 *
 * Signed-out requests are refused inside the file router's middleware, so the
 * session check lives with the upload rules rather than here.
 *
 * Without `UPLOADTHING_TOKEN` the SDK would fail somewhere inside the request;
 * this answers one honest 503 instead, which the editor turns into "dish
 * photos aren't set up yet" rather than showing a storage-provider error.
 */

const handlers = createRouteHandler({ router: ourFileRouter });

function notConfigured() {
  return NextResponse.json(
    {
      error: {
        code: "not_configured",
        message: "Dish photo storage is not set up on this server yet.",
      },
    },
    { status: 503 }
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!process.env.UPLOADTHING_TOKEN) return notConfigured();
  return handlers.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!process.env.UPLOADTHING_TOKEN) return notConfigured();
  return handlers.POST(request);
}

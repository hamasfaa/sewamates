import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { appUrl } from "./env";
import * as Sentry from "@sentry/nextjs";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(appUrl()).origin)
    throw new AppError(
      "INVALID_ORIGIN",
      "Permintaan tidak berasal dari aplikasi. Muat ulang halaman.",
      403,
    );
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("INVALID_ORIGIN", "Permintaan lintas situs ditolak.", 403);
}
export async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_CONTENT_TYPE", "Gunakan format JSON.", 415);
  const source = await request.text();
  if (source.length > 32768) throw new AppError("PAYLOAD_TOO_LARGE", "Data terlalu besar.", 413);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "Data JSON tidak valid.");
  }
}
export function endpoint(handler: (request: Request) => Promise<Response>, mutation = false) {
  return async (request: Request) => {
    try {
      if (mutation) checkOrigin(request);
      return await handler(request);
    } catch (error) {
      if (error instanceof AppError)
        return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof ZodError)
        return json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: error.issues[0]?.message || "Periksa kembali data yang diisi.",
            },
          },
          422,
        );
      const requestId = crypto.randomUUID();
      Sentry.captureException(error, { tags: { request_id: requestId } });
      console.error(
        JSON.stringify({
          level: "error",
          request_id: requestId,
          path: new URL(request.url).pathname,
          error_type: error instanceof Error ? error.name : "unknown",
        }),
      );
      return json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Layanan belum bisa memproses permintaan. Coba beberapa saat lagi.",
            requestId,
          },
        },
        500,
      );
    }
  };
}
export function clientIp(request: Request) {
  // Vercel overwrites this header; do not trust caller-supplied X-Forwarded-For elsewhere.
  return process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim().slice(0, 64) || "unknown"
    : "local";
}

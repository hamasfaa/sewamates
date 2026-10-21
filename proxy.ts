import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
export function proxy(request: NextRequest) {
  // This is an optimistic navigation guard. Services verify the DB session and role.
  if (
    !request.cookies.has("sm_session") &&
    /^\/((admin|profil|notifikasi|daftar|sewakan)(\/|$)|barang\/[^/]+\/(ubah|kalender)$)/.test(
      request.nextUrl.pathname,
    )
  ) {
    return NextResponse.redirect(new URL("/masuk", request.url));
  }
  const nonce = randomBytes(16).toString("base64"),
    dev = process.env.NODE_ENV !== "production";
  const storageOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${storageOrigin}`,
    "font-src 'self'",
    `connect-src 'self' ${storageOrigin} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(!dev && request.nextUrl.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"] };

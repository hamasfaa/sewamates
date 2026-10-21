import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/src/db";
import { findSession, SESSION_COOKIE } from "@/src/services/auth-service";
import { AppError } from "./errors";
import type { Role } from "@/src/db/schema";
export async function currentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !process.env.DATABASE_URL) return null;
  return findSession(getDb(), token);
}
export async function requireActor(roles?: Role[]) {
  const row = await currentSession();
  if (!row) throw new AppError("UNAUTHORIZED", "Masuk dulu untuk melanjutkan.", 401);
  if (roles && !roles.includes(row.user.role))
    throw new AppError("FORBIDDEN", "Kamu tidak memiliki akses ke halaman ini.", 403);
  if (roles && row.user.accountStatus !== "aktif")
    throw new AppError("FORBIDDEN", "Akses admin untuk akun ini sedang dibatasi.", 403);
  return row;
}
export async function requirePageActor(roles?: Role[]) {
  const row = await currentSession();
  if (!row) redirect("/masuk");
  if (roles && (!roles.includes(row.user.role) || row.user.accountStatus !== "aktif"))
    redirect("/profil");
  return row;
}

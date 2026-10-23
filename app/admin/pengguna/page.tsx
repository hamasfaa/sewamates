import { requirePageActor } from "@/src/lib/auth";
import { UsersPanel } from "@/src/components/admin-trust";
export const metadata = { title: "Pengguna" };
export default async function Page() {
  const actor = await requirePageActor(["admin", "super_admin"]);
  return <UsersPanel superAdmin={actor.user.role === "super_admin"} />;
}

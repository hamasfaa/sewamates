import { requirePageActor } from "@/src/lib/auth";
import { AdminLayout } from "@/src/components/admin-layout";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor(["admin", "super_admin"]);
  return <AdminLayout superAdmin={actor.user.role === "super_admin"}>{children}</AdminLayout>;
}

import { requirePageActor } from "@/src/lib/auth";
import { AdminDisputes } from "@/src/components/admin-disputes";
export const metadata = { title: "Sengketa" };
export default async function Page() {
  await requirePageActor(["admin", "super_admin"]);
  return <AdminDisputes />;
}

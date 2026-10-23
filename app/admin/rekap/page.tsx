import { requirePageActor } from "@/src/lib/auth";
import { RecapPanel } from "@/src/components/admin-trust";
export const metadata = { title: "Rekap" };
export default async function Page() {
  const actor = await requirePageActor(["admin", "super_admin"]);
  return <RecapPanel superAdmin={actor.user.role === "super_admin"} />;
}

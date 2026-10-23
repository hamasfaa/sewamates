import { requirePageActor } from "@/src/lib/auth";
import { AdminPayouts } from "@/src/components/admin-payouts";
export const metadata = { title: "Pencairan & refund" };
export default async function Page() {
  const actor = await requirePageActor(["admin", "super_admin"]);
  return <AdminPayouts actorId={actor.user.id} />;
}

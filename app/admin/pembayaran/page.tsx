import { requirePageActor } from "@/src/lib/auth";
import { AdminPayments } from "@/src/components/admin-payments";
export const metadata = { title: "Verifikasi pembayaran" };
export default async function Page() {
  const actor = await requirePageActor(["admin", "super_admin"]);
  return <AdminPayments actorId={actor.user.id} />;
}

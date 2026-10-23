import { requirePageActor } from "@/src/lib/auth";
import { CashPanel } from "@/src/components/admin-cash";
export const metadata = { title: "Kas platform" };
export default async function Page() {
  await requirePageActor(["admin", "super_admin"]);
  return <CashPanel />;
}

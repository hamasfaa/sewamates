import { requirePageActor } from "@/src/lib/auth";
import { TransactionsView } from "@/src/components/transactions-view";
export const metadata = { title: "Transaksi" };
export default async function Page() {
  await requirePageActor();
  return <TransactionsView />;
}

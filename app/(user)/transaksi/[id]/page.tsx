import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageActor } from "@/src/lib/auth";
import { TransactionsView } from "@/src/components/transactions-view";
export const metadata = { title: "Detail transaksi" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageActor();
  return <TransactionsView selectedId={id} />;
}

import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageActor } from "@/src/lib/auth";
import { RentalRequest } from "@/src/components/rental-request";
export const metadata = { title: "Ajukan sewa" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageActor();
  return <RentalRequest itemId={id} />;
}

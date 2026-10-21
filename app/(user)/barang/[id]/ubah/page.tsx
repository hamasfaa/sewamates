import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageActor } from "@/src/lib/auth";
import { ListingWizard } from "@/src/components/listing-wizard";
export const metadata: Metadata = { title: "Ubah listing" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageActor();
  return <ListingWizard itemId={id} />;
}

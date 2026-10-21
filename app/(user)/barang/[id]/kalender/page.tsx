import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageActor } from "@/src/lib/auth";
import { wibDateKey } from "@/src/domain/availability";
import { BlockManager } from "@/src/components/block-manager";
export const metadata: Metadata = { title: "Kalender blokir" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageActor();
  return <BlockManager itemId={id} today={wibDateKey(new Date())} />;
}

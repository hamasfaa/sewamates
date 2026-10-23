import { notFound } from "next/navigation";
import { z } from "zod";
import { ReportChat } from "@/src/components/admin-trust";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <ReportChat id={id} />;
}

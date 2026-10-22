import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageActor } from "@/src/lib/auth";
import { ChatView } from "@/src/components/chat-view";
export const metadata = { title: "Percakapan" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await requirePageActor();
  return <ChatView selectedId={id} userId={actor.user.id} />;
}

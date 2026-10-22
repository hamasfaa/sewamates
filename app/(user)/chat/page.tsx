import { requirePageActor } from "@/src/lib/auth";
import { ChatView } from "@/src/components/chat-view";
export const metadata = { title: "Chat" };
export default async function Page() {
  const actor = await requirePageActor();
  return <ChatView userId={actor.user.id} />;
}

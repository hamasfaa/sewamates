import { requirePageActor } from "@/src/lib/auth";
import { ProfileLayout } from "@/src/components/profile-layout";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  return <ProfileLayout admin={actor.user.role !== "user"}>{children}</ProfileLayout>;
}

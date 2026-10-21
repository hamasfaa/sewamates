import { redirect } from "next/navigation";
import { requirePageActor } from "@/src/lib/auth";
import { ProfileForm } from "@/src/components/profile-form";
export default async function Page() {
  const actor = await requirePageActor();
  if (actor.user.termsAcceptedAt && actor.user.name) redirect("/profil");
  return (
    <div className="page-container max-w-2xl py-10">
      <ProfileForm onboarding />
    </div>
  );
}

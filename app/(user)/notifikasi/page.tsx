import { requirePageActor } from "@/src/lib/auth";
import { NotificationsList } from "@/src/components/notifications-list";
export default async function Page() {
  await requirePageActor();
  return (
    <div className="page-container max-w-3xl py-10">
      <NotificationsList />
    </div>
  );
}

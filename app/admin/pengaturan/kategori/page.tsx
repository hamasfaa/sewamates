import { requirePageActor } from "@/src/lib/auth";
import { CategoryManager, SettingsTabs } from "@/src/components/admin-catalog";
export default async function Page() {
  await requirePageActor(["super_admin"]);
  return (
    <>
      <SettingsTabs />
      <CategoryManager />
    </>
  );
}

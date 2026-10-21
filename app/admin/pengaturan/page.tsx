import { requirePageActor } from "@/src/lib/auth";
import { SettingsPanel } from "@/src/components/admin-panels";
import { SettingsTabs } from "@/src/components/admin-catalog";
export default async function Page() {
  await requirePageActor(["super_admin"]);
  return (
    <>
      <SettingsTabs />
      <SettingsPanel />
    </>
  );
}

import { requirePageActor } from "@/src/lib/auth";
import { SettingsPanel } from "@/src/components/admin-panels";
export default async function Page() {
  await requirePageActor(["super_admin"]);
  return <SettingsPanel />;
}

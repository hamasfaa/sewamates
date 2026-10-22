import { requirePageActor } from "@/src/lib/auth";
import { SettingsTabs } from "@/src/components/admin-catalog";
import { PlatformAccounts } from "@/src/components/platform-accounts";
export const metadata = { title: "Rekening platform" };
export default async function Page() {
  await requirePageActor(["super_admin"]);
  return (
    <>
      <SettingsTabs />
      <PlatformAccounts />
    </>
  );
}

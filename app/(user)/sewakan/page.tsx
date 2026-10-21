import type { Metadata } from "next";
import { requirePageActor } from "@/src/lib/auth";
import { ListingWizard } from "@/src/components/listing-wizard";
export const metadata: Metadata = { title: "Sewakan barang" };
export default async function Page() {
  await requirePageActor();
  return <ListingWizard />;
}

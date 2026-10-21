import type { Metadata } from "next";
import { currentSession } from "@/src/lib/auth";
import { searchInput } from "@/src/lib/validation";
import { SearchView, type SearchFilters } from "@/src/components/search-view";
export const metadata: Metadata = { title: "Cari barang" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    session = await currentSession();
  const single = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  // Logged-in users start from their own campus; "semua" opts into every campus.
  const defaultCampus = session?.user.campusId || "";
  const parsed = searchInput.safeParse({ ...single, campus: undefined, cursor: undefined });
  const valid = parsed.success ? parsed.data : {};
  const campus =
    single.campus === "semua" ? "" : searchInput.safeParse({ campus: single.campus }).data?.campus;
  const initial: SearchFilters = {
    q: valid.q || "",
    category: valid.category || "",
    campus: campus ?? defaultCampus,
    point: valid.point || "",
    min: valid.min ?? null,
    max: valid.max ?? null,
    from: valid.from || "",
    to: valid.to || "",
    sort: valid.sort || "",
  };
  return (
    <SearchView key={JSON.stringify(single)} initial={initial} defaultCampus={defaultCampus} />
  );
}

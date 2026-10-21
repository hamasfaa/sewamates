import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/src/db";
import { campuses } from "@/src/db/schema";
import { filterCampuses } from "@/src/domain/campuses";

export const campusFields = {
  id: campuses.id,
  name: campuses.name,
  domains: campuses.domains,
  isActive: campuses.isActive,
};

export async function listCampuses(db: Executor, query = "") {
  const search = z.string().trim().max(100).parse(query);
  const rows = await db
    .select(campusFields)
    .from(campuses)
    .where(eq(campuses.isActive, true))
    .orderBy(asc(campuses.name), asc(campuses.id));
  return filterCampuses(rows, search);
}

const snapshotSchema = z.array(
  z.object({
    name: z.string().trim().min(3).max(200),
    country: z.string(),
    alpha_two_code: z.string().length(2),
    domains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
      )
      .min(1),
  }),
);

// The caller wraps the whole import in a transaction (also shared by the seed).
export async function importCampusSnapshot(db: Executor, raw: unknown) {
  const rows = snapshotSchema
    .parse(raw)
    .filter((row) => row.alpha_two_code === "ID" && row.country === "Indonesia");
  if (!rows.length) throw new Error("Snapshot tidak berisi kampus Indonesia.");
  const records = rows.map((row) => ({
    name: row.name,
    sourceKey: `hipo:${row.domains[0]}`,
    domains: [...new Set(row.domains)],
  }));
  if (new Set(records.map((row) => row.sourceKey)).size !== records.length)
    throw new Error("Domain utama kampus duplikat. Tinjau snapshot sebelum mengimpor.");

  await db
    .insert(campuses)
    .values(records)
    .onConflictDoUpdate({
      target: campuses.sourceKey,
      set: { name: sql`excluded.name`, domains: sql`excluded.domains` },
    });
  // Keep old references intact, but stop offering the original demo campus.
  await db
    .update(campuses)
    .set({ isActive: false })
    .where(
      and(
        eq(campuses.id, "00000000-0000-4000-8000-000000000001"),
        eq(campuses.name, "Kampus Surabaya"),
      ),
    );
  return records.length;
}

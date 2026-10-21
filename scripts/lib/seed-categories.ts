import { sql } from "drizzle-orm";
import type { Executor } from "../../src/db";
import { categories } from "../../src/db/schema";

// Starting taxonomy; super admins rename, deactivate, or extend it from the panel.
export const DEFAULT_CATEGORIES = [
  "Elektronik & Gadget",
  "Kamera & Foto",
  "Komputer & Aksesori",
  "Buku & Alat Kuliah",
  "Olahraga",
  "Outdoor & Camping",
  "Alat Musik",
  "Pakaian & Kostum",
  "Perlengkapan Acara",
  "Hobi & Permainan",
  "Perlengkapan Kos",
  "Lainnya",
];
// Only an empty table is seeded, so renamed or deleted categories never come back.
export async function seedDefaultCategories(db: Executor) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(categories);
  if (total > 0) return 0;
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((name) => ({ name })));
  return DEFAULT_CATEGORIES.length;
}

import { and, asc, desc, eq, gt, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/src/db";
import { campuses, categories, items, users } from "@/src/db/schema";
import { wibDayRange, type Period } from "@/src/domain/availability";
import { campusLabel } from "@/src/domain/campuses";
import {
  defaultSort,
  prefixQuery,
  SEARCH_PAGE_SIZE,
  SEARCH_SORTS,
  searchTerms,
  type SearchSort,
} from "@/src/domain/search";
import { AppError } from "@/src/lib/errors";
import { publicItemUrl } from "@/src/lib/storage";
import { searchInput } from "@/src/lib/validation";
import { activeCategories } from "./catalog-service";
import { coverThumb, publiclyListed } from "./item-service";

type Order = SearchSort | "populer";
// Cards show the accent "Baru" badge for recently published listings (03 §7.2).
const NEW_FOR_DAYS = 3;
type CursorKey = [string | number, string];
type Query = {
  terms?: string[];
  category?: string;
  campus?: string;
  point?: string;
  owner?: string;
  min?: number;
  max?: number;
  period?: Period;
  popularOnly?: boolean;
  sort: Order;
  after?: CursorKey;
  limit: number;
};
const cursorSchema = z.object({
  s: z.enum([...SEARCH_SORTS, "populer"]),
  k: z.tuple([z.union([z.string().max(40), z.number()]), z.uuid()]),
});
function encodeCursor(sort: Order, key: CursorKey) {
  return Buffer.from(JSON.stringify({ s: sort, k: key })).toString("base64url");
}
function decodeCursor(value: string, sort: Order): CursorKey {
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    const [key] = cursor.k;
    if (
      cursor.s === sort &&
      (sort === "terbaru" ? typeof key === "string" : typeof key === "number")
    )
      return cursor.k;
  } catch {}
  throw new AppError(
    "INVALID_CURSOR",
    "Halaman berikutnya tidak valid. Muat ulang pencarian.",
    422,
  );
}
async function queryItems(db: Executor, query: Query) {
  const tsQuery = query.terms?.length ? prefixQuery(query.terms) : null;
  const match = tsQuery ? sql`to_tsquery('simple', ${tsQuery})` : null;
  const rank = match
    ? sql<number>`ts_rank("items"."search_tsv", ${match})::float8`
    : sql<number>`0::float8`;
  // Microsecond text keeps keyset pagination exact; JavaScript dates only hold milliseconds.
  const publishedKey = sql<string>`to_char(${items.publishedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  // Each order ends with the id so ties still page deterministically.
  const orders: Record<Order, { by: SQL[]; key: (row: Row) => string | number; after: SQL }> = {
    relevan: {
      by: [desc(rank), asc(items.id)],
      key: (row) => row.rank,
      after: sql`(${rank} < ${query.after?.[0]} OR (${rank} = ${query.after?.[0]} AND ${items.id} > ${query.after?.[1]}))`,
    },
    terbaru: {
      by: [desc(items.publishedAt), desc(items.id)],
      key: (row) => row.publishedKey,
      after: sql`(${items.publishedAt}, ${items.id}) < (${query.after?.[0]}::timestamptz, ${query.after?.[1]}::uuid)`,
    },
    termurah: {
      by: [asc(items.pricePerDay), asc(items.id)],
      key: (row) => row.pricePerDay,
      after: sql`(${items.pricePerDay}, ${items.id}) > (${query.after?.[0]}::bigint, ${query.after?.[1]}::uuid)`,
    },
    rating: {
      by: [desc(items.ratingAvg), asc(items.id)],
      key: (row) => row.ratingAvg,
      after: sql`(${items.ratingAvg} < ${query.after?.[0]}::int OR (${items.ratingAvg} = ${query.after?.[0]}::int AND ${items.id} > ${query.after?.[1]}::uuid))`,
    },
    populer: {
      by: [desc(items.completedCount), asc(items.id)],
      key: (row) => row.completedCount,
      after: sql`(${items.completedCount} < ${query.after?.[0]}::int OR (${items.completedCount} = ${query.after?.[0]}::int AND ${items.id} > ${query.after?.[1]}::uuid))`,
    },
  };
  const order = orders[query.sort];
  const period = query.period;
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      pricePerDay: items.pricePerDay,
      ratingAvg: items.ratingAvg,
      ratingCount: items.ratingCount,
      completedCount: items.completedCount,
      publishedAt: items.publishedAt,
      publishedKey,
      rank,
      thumbPath: coverThumb,
      pointName: sql<
        string | null
      >`(SELECT p.name FROM item_pickup_points ip JOIN pickup_points p ON p.id = ip.pickup_point_id WHERE ip.item_id = "items"."id" AND p.active ORDER BY p.name LIMIT 1)`,
      categoryName: categories.name,
      campusName: campuses.name,
      campusDomains: campuses.domains,
    })
    .from(items)
    .innerJoin(users, eq(users.id, items.ownerId))
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .innerJoin(campuses, eq(campuses.id, items.campusId))
    .where(
      and(
        publiclyListed,
        match ? sql`"items"."search_tsv" @@ ${match}` : undefined,
        query.category ? eq(items.categoryId, query.category) : undefined,
        query.campus ? eq(items.campusId, query.campus) : undefined,
        query.owner ? eq(items.ownerId, query.owner) : undefined,
        query.point
          ? sql`EXISTS (SELECT 1 FROM item_pickup_points ip JOIN pickup_points p ON p.id = ip.pickup_point_id WHERE ip.item_id = "items"."id" AND p.id = ${query.point} AND p.active)`
          : undefined,
        query.min !== undefined ? gte(items.pricePerDay, query.min) : undefined,
        query.max !== undefined ? lte(items.pricePerDay, query.max) : undefined,
        // Owner blocks now; Sprint 3 adds approved rental holds to the same filter.
        period
          ? sql`NOT EXISTS (SELECT 1 FROM availability_blocks b WHERE b.item_id = "items"."id" AND b.period && tstzrange(${period.start.toISOString()}::timestamptz, ${period.end.toISOString()}::timestamptz, '[)'))`
          : undefined,
        query.popularOnly ? gt(items.completedCount, 0) : undefined,
        query.after ? order.after : undefined,
      ),
    )
    .orderBy(...order.by)
    .limit(query.limit + 1);
  type Row = (typeof rows)[number];
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1],
    newSince = Date.now() - NEW_FOR_DAYS * 86400000;
  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      pricePerDay: row.pricePerDay,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      isNew: Boolean(row.publishedAt && row.publishedAt.getTime() > newSince),
      thumbUrl: publicItemUrl(row.thumbPath),
      pointName: row.pointName,
      categoryName: row.categoryName,
      campus: campusLabel({ name: row.campusName, domains: row.campusDomains }),
    })),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor(query.sort, [order.key(last), last.id])
        : null,
  };
}
export type ItemCardData = Awaited<ReturnType<typeof queryItems>>["items"][number];

export async function searchItems(db: Executor, raw: Record<string, unknown>) {
  const input = searchInput.parse(raw);
  const terms = searchTerms(input.q || "");
  const sort =
    input.sort && (input.sort !== "relevan" || terms.length) ? input.sort : defaultSort(input.q);
  // A single date means "available on that day".
  const from = input.from ?? input.to,
    to = input.to ?? input.from;
  const result = await queryItems(db, {
    terms,
    category: input.category,
    campus: input.campus,
    point: input.point,
    min: input.min,
    max: input.max,
    period: from && to ? wibDayRange(from, to) : undefined,
    sort,
    after: input.cursor ? decodeCursor(input.cursor, sort) : undefined,
    limit: SEARCH_PAGE_SIZE,
  });
  return { ...result, sort };
}
export async function homeFeed(db: Executor) {
  const [newest, popular, categoryList] = await Promise.all([
    queryItems(db, { sort: "terbaru", limit: 8 }),
    queryItems(db, { sort: "populer", popularOnly: true, limit: 8 }),
    activeCategories(db),
  ]);
  return { newest: newest.items, popular: popular.items, categories: categoryList };
}
export async function ownerListings(db: Executor, ownerId: string) {
  return (await queryItems(db, { owner: ownerId, sort: "terbaru", limit: 8 })).items;
}

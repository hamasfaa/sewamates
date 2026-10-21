import "server-only";
import { z } from "zod";
import { getDb } from "@/src/db";
import type { User } from "@/src/db/schema";
import type { OwnerAction } from "@/src/domain/listing";
import {
  activeCategories,
  activePickupPoints,
  adminCategories,
  adminPickupPoints,
  createCategory,
  createPickupPoint,
  deleteCategory,
  deletePickupPoint,
  updateCategory,
  updatePickupPoint,
} from "@/src/services/catalog-service";
import {
  addBlock,
  changeItemStatus,
  createItem,
  itemAvailability,
  itemBlocks,
  itemDetail,
  itemForEdit,
  listingOptions,
  myItems,
  removeBlock,
  updateItem,
} from "@/src/services/item-service";
import { decideItem, moderationDetail, moderationQueue } from "@/src/services/moderation-service";
import { searchItems } from "@/src/services/search-service";
import { currentSession } from "./auth";
import { assert } from "./errors";
import { body, json } from "./http";

export type RouteContext = {
  request: Request;
  url: URL;
  path: string;
  parts: string[];
  method: string;
};
const uuid = (value: string | null | undefined) =>
  z.uuid("Data yang diminta tidak valid.").parse(value);
const viewer = async () => (await currentSession())?.user ?? null;

// Readable without a session; owners and admins still see their own hidden listings.
// The database is resolved per matched route so unrelated paths keep their own errors.
export async function publicMarketplaceRoute({ url, path, parts, method }: RouteContext) {
  if (method !== "GET") return null;
  if (path === "items")
    return json(await searchItems(getDb(), Object.fromEntries(url.searchParams)));
  if (path === "categories") return json(await activeCategories(getDb()));
  if (path === "pickup-points")
    return json(await activePickupPoints(getDb(), uuid(url.searchParams.get("campus"))));
  if (/^items\/[^/]+$/.test(path)) {
    const detail = await itemDetail(getDb(), uuid(parts[1]), await viewer());
    assert(detail, "NOT_FOUND", "Barang tidak ditemukan.", 404);
    return json(detail);
  }
  if (/^items\/[^/]+\/availability$/.test(path))
    return json(
      await itemAvailability(
        getDb(),
        uuid(parts[1]),
        url.searchParams.get("month") || "",
        await viewer(),
      ),
    );
  return null;
}

export async function privateMarketplaceRoute(
  { request, url, path, parts, method }: RouteContext,
  actor: User,
  key?: string,
) {
  const db = getDb();
  if (path === "me/listing-options" && method === "GET")
    return json(await listingOptions(db, actor));
  if (path === "me/items" && method === "GET") return json(await myItems(db, actor));
  if (path === "items" && method === "POST")
    return json(await createItem(db, actor, await body(request), key), 201);
  if (/^items\/[^/]+$/.test(path) && method === "PATCH")
    return json(await updateItem(db, actor, uuid(parts[1]), await body(request), key));
  if (/^items\/[^/]+\/edit$/.test(path) && method === "GET")
    return json(await itemForEdit(db, actor, uuid(parts[1])));
  if (/^items\/[^/]+\/(pause|resume|archive)$/.test(path) && method === "POST")
    return json(await changeItemStatus(db, actor, uuid(parts[1]), parts[2] as OwnerAction, key));
  if (/^items\/[^/]+\/blocks$/.test(path) && method === "GET")
    return json(await itemBlocks(db, actor, uuid(parts[1])));
  if (/^items\/[^/]+\/blocks$/.test(path) && method === "POST")
    return json(await addBlock(db, actor, uuid(parts[1]), await body(request), key), 201);
  if (/^items\/[^/]+\/blocks\/[^/]+$/.test(path) && method === "DELETE")
    return json(await removeBlock(db, actor, uuid(parts[1]), uuid(parts[3])));
  if (path === "admin/items/pending" && method === "GET")
    return json(await moderationQueue(db, actor));
  if (/^admin\/items\/[^/]+$/.test(path) && method === "GET")
    return json(await moderationDetail(db, actor, uuid(parts[2])));
  if (/^admin\/items\/[^/]+\/decision$/.test(path) && method === "POST")
    return json(await decideItem(db, actor, uuid(parts[2]), await body(request), key));
  if (path === "admin/categories" && method === "GET")
    return json(await adminCategories(db, actor));
  if (path === "admin/categories" && method === "POST")
    return json(await createCategory(db, actor, await body(request), key), 201);
  if (/^admin\/categories\/[^/]+$/.test(path) && method === "PATCH")
    return json(await updateCategory(db, actor, uuid(parts[2]), await body(request), key));
  if (/^admin\/categories\/[^/]+$/.test(path) && method === "DELETE")
    return json(await deleteCategory(db, actor, uuid(parts[2]), key));
  if (path === "admin/pickup-points" && method === "GET")
    return json(
      await adminPickupPoints(
        db,
        actor,
        url.searchParams.has("campus") ? uuid(url.searchParams.get("campus")) : undefined,
      ),
    );
  if (path === "admin/pickup-points" && method === "POST")
    return json(await createPickupPoint(db, actor, await body(request), key), 201);
  if (/^admin\/pickup-points\/[^/]+$/.test(path) && method === "PATCH")
    return json(await updatePickupPoint(db, actor, uuid(parts[2]), await body(request), key));
  if (/^admin\/pickup-points\/[^/]+$/.test(path) && method === "DELETE")
    return json(await deletePickupPoint(db, actor, uuid(parts[2]), key));
  return null;
}

import "server-only";
import { z } from "zod";
import { getDb } from "@/src/db";
import type { User } from "@/src/db/schema";
import { decideDispute, respondDispute } from "@/src/services/dispute-service";
import { rentalReviews, submitReview } from "@/src/services/review-service";
import {
  adminUserDetail,
  adminUsers,
  changeRole,
  createReport,
  handleReport,
  myBlocks,
  manageUser,
  reportQueue,
} from "@/src/services/trust-service";
import {
  createAdjustment,
  financialRecap,
  listReconciliations,
  recordReconciliation,
  withdrawCommission,
} from "@/src/services/admin-finance-service";
import { requestAccountDeletion } from "@/src/services/account-deletion-service";
import { body, json } from "./http";
import type { RouteContext } from "./marketplace-routes";
const uuid = (v: string) => z.uuid().parse(v);
export async function trustRoute(
  { request, path, parts, method, url }: RouteContext,
  actor: User,
  key?: string,
) {
  const db = getDb();
  if (/^disputes\/[^/]+\/respond$/.test(path) && method === "POST")
    return json(await respondDispute(db, actor, uuid(parts[1]), await body(request), key));
  if (/^admin\/disputes\/[^/]+\/decision$/.test(path) && method === "POST")
    return json(await decideDispute(db, actor, uuid(parts[2]), await body(request), key));
  if (/^rentals\/[^/]+\/reviews$/.test(path)) {
    if (method === "GET") return json(await rentalReviews(db, actor, uuid(parts[1])));
    if (method === "POST")
      return json(await submitReview(db, actor, uuid(parts[1]), await body(request), key), 201);
  }
  if (path === "reports" && method === "POST") {
    const raw = (await body(request)) as Record<string, unknown>;
    return json(
      await createReport(
        db,
        actor,
        raw.messageId
          ? { targetType: "message", targetId: raw.messageId, reason: raw.reason }
          : raw,
        key,
      ),
      201,
    );
  }
  if (path === "me/blocks" && method === "GET") return json(await myBlocks(db, actor));
  if (path === "admin/reports" && method === "GET") return json(await reportQueue(db, actor));
  if (/^admin\/reports\/[^/]+\/action$/.test(path) && method === "POST")
    return json(await handleReport(db, actor, uuid(parts[2]), await body(request), key));
  if (path === "admin/users" && method === "GET")
    return json(await adminUsers(db, actor, url.searchParams.get("q") || ""));
  if (/^admin\/users\/[^/]+$/.test(path) && method === "GET")
    return json(await adminUserDetail(db, actor, uuid(parts[2])));
  if (/^admin\/users\/[^/]+\/(suspend|reactivate|strike)$/.test(path) && method === "POST")
    return json(
      await manageUser(
        db,
        actor,
        uuid(parts[2]),
        parts[3] as "suspend" | "reactivate" | "strike",
        await body(request),
        key,
      ),
    );
  if (/^admin\/users\/[^/]+\/role$/.test(path) && method === "PUT")
    return json(await changeRole(db, actor, uuid(parts[2]), await body(request), key));
  if (path === "admin/payout-tasks/adjustments" && method === "POST")
    return json(await createAdjustment(db, actor, await body(request), key), 201);
  if (path === "admin/commission-withdrawals" && method === "POST")
    return json(await withdrawCommission(db, actor, await body(request), key), 201);
  if (path === "admin/reconciliations") {
    if (method === "GET") return json(await listReconciliations(db, actor));
    if (method === "POST")
      return json(await recordReconciliation(db, actor, await body(request), key), 201);
  }
  if (path === "admin/recap" && method === "GET") {
    const recap = await financialRecap(db, actor);
    if (url.searchParams.get("format") === "csv") {
      const rows = [
        ["status", "jumlah", "nilai_sewa", "dana_diterima"],
        ...recap.statuses.map((r) => [r.status, r.count, r.rentalValue, r.received]),
        ["komisi", recap.commission],
        ["dana_ditahan", recap.held],
        ["pencairan_tertunda", recap.pendingPayoutAmount],
      ];
      return new Response("\uFEFF" + rows.map((r) => r.join(",")).join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="rekap-sewamates.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    return json(recap);
  }
  if (path === "me/delete-account" && method === "POST")
    return json(await requestAccountDeletion(db, actor, key), 202);
}

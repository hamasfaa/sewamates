import "server-only";
import { z } from "zod";
import { getDb } from "@/src/db";
import type { User } from "@/src/db/schema";
import {
  actOnRental,
  createRental,
  rentalDetail,
  rentalList,
  rentalOptions,
} from "@/src/services/rental-service";
import {
  decidePayment,
  deletePlatformAccount,
  listPlatformAccounts,
  paymentDetail,
  paymentQueue,
  savePlatformAccount,
  submitPayment,
} from "@/src/services/payment-service";
import {
  adminConversation,
  blockUser,
  conversationList,
  conversationMessages,
  markConversationRead,
  openConversation,
  reportMessage,
  sendMessage,
} from "@/src/services/chat-service";
import {
  addHandoverPhoto,
  arrive,
  checkReturn,
  confirmHandover,
  contestNoShow,
  issueHandoverCode,
  reportNoShow,
} from "@/src/services/handover-service";
import { proposeReschedule, respondReschedule } from "@/src/services/reschedule-service";
import {
  addDisputeEvidence,
  disputeDetail,
  disputeQueue,
  reportProblem,
} from "@/src/services/dispute-service";
import {
  cashOverview,
  claimPayout,
  completePayout,
  payoutDetail,
  payoutQueue,
  recordCashMovement,
  releasePayout,
} from "@/src/services/payout-service";
import type { RouteContext } from "./marketplace-routes";
import { body, json } from "./http";
const uuid = (value: string) => z.uuid().parse(value);
export async function transactionRoute(
  { request, url, path, parts, method }: RouteContext,
  actor: User,
  key?: string,
) {
  const db = getDb();
  if (/^items\/[^/]+\/rental-options$/.test(path) && method === "GET")
    return json(await rentalOptions(db, actor, uuid(parts[1])));
  if (path === "rentals" && method === "POST")
    return json(await createRental(db, actor, await body(request), key), 201);
  if (path === "rentals" && method === "GET")
    return json(
      await rentalList(
        db,
        actor,
        url.searchParams.get("role") || "renter",
        url.searchParams.get("state") || undefined,
      ),
    );
  if (/^rentals\/[^/]+$/.test(path) && method === "GET")
    return json(await rentalDetail(db, actor, uuid(parts[1])));
  if (/^rentals\/[^/]+\/(approve|reject|cancel)$/.test(path) && method === "POST")
    return json(
      await actOnRental(
        db,
        actor,
        uuid(parts[1]),
        parts[2] as "approve" | "reject" | "cancel",
        await body(request),
        key,
      ),
    );
  if (/^rentals\/[^/]+\/payments$/.test(path) && method === "POST")
    return json(await submitPayment(db, actor, uuid(parts[1]), await body(request), key), 201);
  if (method === "POST" && parts[0] === "rentals" && parts.length >= 3) {
    const id = uuid(parts[1]),
      action = parts.slice(2).join("/");
    if (action === "arrive") return json(await arrive(db, actor, id, await body(request), key));
    if (action === "handover/photos")
      return json(await addHandoverPhoto(db, actor, id, await body(request), key), 201);
    if (action === "handover/code") return json(await issueHandoverCode(db, actor, id));
    if (action === "handover/confirm")
      return json(await confirmHandover(db, actor, id, await body(request), key));
    if (action === "check") return json(await checkReturn(db, actor, id, await body(request), key));
    if (action === "reschedule")
      return json(await proposeReschedule(db, actor, id, await body(request), key), 201);
    if (/^reschedule\/[^/]+\/respond$/.test(action))
      return json(await respondReschedule(db, actor, id, uuid(parts[3]), await body(request), key));
    if (action === "no-show") return json(await reportNoShow(db, actor, id, key), 201);
    if (/^no-show\/[^/]+\/dispute$/.test(action))
      return json(await contestNoShow(db, actor, id, uuid(parts[3]), await body(request), key));
    if (action === "disputes")
      return json(await reportProblem(db, actor, id, await body(request), key), 201);
  }
  if (/^disputes\/[^/]+\/evidence$/.test(path) && method === "POST")
    return json(await addDisputeEvidence(db, actor, uuid(parts[1]), await body(request), key), 201);
  if (path === "admin/payout-tasks" && method === "GET")
    return json(
      await payoutQueue(db, actor, {
        state: url.searchParams.get("state") || "open",
        sla: url.searchParams.get("sla") || "all",
        q: url.searchParams.get("q") || "",
      }),
    );
  if (/^admin\/payout-tasks\/[^/]+$/.test(path) && method === "GET")
    return json(await payoutDetail(db, actor, uuid(parts[2])));
  if (/^admin\/payout-tasks\/[^/]+\/claim$/.test(path) && method === "POST")
    return json(await claimPayout(db, actor, uuid(parts[2]), key));
  if (/^admin\/payout-tasks\/[^/]+\/release$/.test(path) && method === "POST")
    return json(await releasePayout(db, actor, uuid(parts[2])));
  if (/^admin\/payout-tasks\/[^/]+\/complete$/.test(path) && method === "POST")
    return json(await completePayout(db, actor, uuid(parts[2]), await body(request), key));
  if (path === "admin/cash" && method === "GET") return json(await cashOverview(db, actor));
  if (path === "admin/cash-movements" && method === "POST")
    return json(await recordCashMovement(db, actor, await body(request), key), 201);
  if (path === "admin/disputes" && method === "GET") return json(await disputeQueue(db, actor));
  if (/^admin\/disputes\/[^/]+$/.test(path) && method === "GET")
    return json(await disputeDetail(db, actor, uuid(parts[2])));
  if (path === "admin/payments" && method === "GET")
    return json(
      await paymentQueue(db, actor, {
        q: url.searchParams.get("q") || "",
        sla: url.searchParams.get("sla") || "all",
      }),
    );
  if (/^admin\/payments\/[^/]+$/.test(path) && method === "GET")
    return json(await paymentDetail(db, actor, uuid(parts[2])));
  if (/^admin\/payments\/[^/]+\/decision$/.test(path) && method === "POST")
    return json(await decidePayment(db, actor, uuid(parts[2]), await body(request), key));
  if (path === "admin/platform-accounts" && method === "GET")
    return json(await listPlatformAccounts(db, actor));
  if (path === "admin/platform-accounts" && method === "POST")
    return json(await savePlatformAccount(db, actor, null, await body(request), key), 201);
  if (/^admin\/platform-accounts\/[^/]+$/.test(path) && method === "PATCH")
    return json(await savePlatformAccount(db, actor, uuid(parts[2]), await body(request), key));
  if (/^admin\/platform-accounts\/[^/]+$/.test(path) && method === "DELETE")
    return json(await deletePlatformAccount(db, actor, uuid(parts[2])));
  if (path === "conversations" && method === "GET") return json(await conversationList(db, actor));
  if (path === "conversations" && method === "POST")
    return json(
      await openConversation(
        db,
        actor,
        z
          .object({ itemId: z.uuid() })
          .strict()
          .parse(await body(request)).itemId,
        key,
      ),
      201,
    );
  if (/^conversations\/[^/]+\/messages$/.test(path) && method === "GET")
    return json(
      await conversationMessages(
        db,
        actor,
        uuid(parts[1]),
        url.searchParams.get("cursor") || undefined,
      ),
    );
  if (/^conversations\/[^/]+\/messages$/.test(path) && method === "POST")
    return json(await sendMessage(db, actor, uuid(parts[1]), await body(request), key), 201);
  if (/^conversations\/[^/]+\/read$/.test(path) && method === "POST")
    return json(
      await markConversationRead(
        db,
        actor,
        uuid(parts[1]),
        z
          .object({ lastMessageId: z.uuid() })
          .strict()
          .parse(await body(request)).lastMessageId,
      ),
    );
  if (/^users\/[^/]+\/block$/.test(path) && ["POST", "DELETE"].includes(method))
    return json(await blockUser(db, actor, uuid(parts[1]), method === "POST"));
  if (path === "reports" && method === "POST") {
    const input = z
      .object({ messageId: z.uuid(), reason: z.string().trim().min(5).max(1000) })
      .strict()
      .parse(await body(request));
    return json(await reportMessage(db, actor, input.messageId, input.reason, key), 201);
  }
  if (/^admin\/conversations\/[^/]+$/.test(path) && method === "GET")
    return json(await adminConversation(db, actor, uuid(parts[2])));
  return null;
}

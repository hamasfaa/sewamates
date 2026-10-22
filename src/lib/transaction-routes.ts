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
  if (path === "admin/payments" && method === "GET") return json(await paymentQueue(db, actor));
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

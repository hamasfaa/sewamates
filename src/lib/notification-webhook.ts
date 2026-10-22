import "server-only";
import { after } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/src/db";
import { deliverNotificationEvent } from "@/src/jobs/deliver-notifications";
import { safeEqual } from "./crypto";
import { required } from "./env";
import { assert } from "./errors";
import { body, endpoint, json } from "./http";

export const notificationWebhook = endpoint(async (request) => {
  assert(
    safeEqual(
      request.headers.get("authorization") || "",
      `Bearer ${required("INTERNAL_JOB_SECRET")}`,
    ),
    "FORBIDDEN",
    "Webhook notifikasi tidak terotorisasi.",
    403,
  );
  const { deliveryId } = z
    .object({ deliveryId: z.uuid() })
    .strict()
    .parse(await body(request));
  // pg_net sends only after commit. Acknowledge quickly, then finish within Vercel's lifetime.
  after(async () => {
    try {
      await deliverNotificationEvent(getDb(), deliveryId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { job: "telegram-notification", trigger: "database" },
      });
      console.error(
        JSON.stringify({ level: "error", job: "telegram-notification", delivery_id: deliveryId }),
      );
    }
  });
  return json({ accepted: true }, 202);
});

import "server-only";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/src/db";
import { deliverNotifications } from "@/src/jobs/deliver-notifications";

export function withNotificationDelivery(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const response = await handler(request);
    if (
      response.ok &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      process.env.TELEGRAM_BOT_TOKEN &&
      new URL(request.url).pathname !== "/api/internal/jobs/deliver-notifications"
    ) {
      after(async () => {
        try {
          // The response follows the database commit; only committed outbox rows are visible.
          await deliverNotifications(getDb());
        } catch (error) {
          // Committed deliveries remain available to the cron worker.
          Sentry.captureException(error, {
            tags: { job: "deliver-notifications", trigger: "after" },
          });
          console.error(
            JSON.stringify({ level: "error", job: "deliver-notifications", trigger: "after" }),
          );
        }
      });
    }
    return response;
  };
}

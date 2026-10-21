import * as Sentry from "@sentry/nextjs";
import { scrubErrorEvent } from "./src/lib/observability";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubErrorEvent,
});
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

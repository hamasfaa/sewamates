import type { ErrorEvent } from "@sentry/nextjs";

// Database and Telegram errors can contain SQL params or token-bearing URLs.
// Keep stack frames and error types, while omitting free-form payloads.
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.message;
  for (const exception of event.exception?.values || [])
    exception.value = exception.type || "Error";
  return event;
}

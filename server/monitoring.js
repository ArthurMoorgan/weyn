// Error tracking (Sentry) + product analytics (PostHog). Both are no-ops
// when their env var isn't set, so local dev / CI never needs real keys.
import * as Sentry from "@sentry/node";
import { PostHog } from "posthog-node";

let sentryReady = false;
export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || "development", tracesSampleRate: 0.1 });
  sentryReady = true;
}
export function captureError(err, context) {
  console.error("[weyn]", err);
  if (sentryReady) Sentry.captureException(err, context ? { extra: context } : undefined);
}
export { Sentry, sentryReady };

let posthog = null;
export function initPostHog() {
  if (!process.env.POSTHOG_API_KEY) return;
  posthog = new PostHog(process.env.POSTHOG_API_KEY, { host: process.env.POSTHOG_HOST || "https://us.i.posthog.com" });
}
// distinctId should be the userId when known, otherwise a stable deviceId —
// never omit it, PostHog buckets anonymous events under a shared "null" id
// that makes funnels meaningless.
export function trackEvent(distinctId, event, properties) {
  if (!posthog || !distinctId) return;
  posthog.capture({ distinctId, event, properties });
}
export async function shutdownPostHog() {
  if (posthog) await posthog.shutdown();
}

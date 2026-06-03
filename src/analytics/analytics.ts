import { PostHog } from "posthog-node";
import * as vscode from "vscode";

// Imported from the generated file (baked in at compile time by scripts/generate-analytics-config.ts).
// Falls back to the empty-key stub so the module always resolves even in local dev.
let POSTHOG_API_KEY: string;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  POSTHOG_API_KEY = (require("./posthogConfig.generated") as { POSTHOG_API_KEY: string }).POSTHOG_API_KEY;
} catch {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  POSTHOG_API_KEY = (require("./posthogConfig") as { POSTHOG_API_KEY: string }).POSTHOG_API_KEY;
}

let client: PostHog | undefined;
let userId: string | undefined;
let orgSlug: string | undefined;

export function initAnalytics(): void {
  if (!vscode.env.isTelemetryEnabled || !POSTHOG_API_KEY) {
    return;
  }
  client = new PostHog(POSTHOG_API_KEY, { host: "https://app.posthog.com", flushAt: 1, flushInterval: 0 });
}

export function identifyUser(userUuid: string, slug: string): void {
  userId = userUuid;
  orgSlug = slug;
  client?.identify({
    distinctId: userUuid,
    properties: { org_slug: slug },
  });
}

export function resetIdentity(): void {
  userId = undefined;
  orgSlug = undefined;
}

export function track(action: string, properties?: Record<string, unknown>): void {
  if (!client || !userId) {
    return;
  }
  client.capture({
    distinctId: userId,
    event: "vscode_extension",
    properties: { org_slug: orgSlug, action, ...properties },
  });
}

export function shutdownAnalytics(): Promise<void> {
  return client?.shutdown() ?? Promise.resolve();
}

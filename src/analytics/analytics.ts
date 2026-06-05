import * as vscode from "vscode";
import { PostHog } from "posthog-node";

// The key is baked in at compile time by scripts/generate-analytics-config.ts,
// which writes the gitignored posthogConfig.generated.ts. Fall back to the
// checked-in empty-key stub so the module still resolves on a fresh checkout
// (before the generator runs) and in local / open-source builds.
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
let hasAliased = false;

// Honour the VS Code telemetry setting at startup and whenever it is toggled mid-session.
export function initAnalytics(): vscode.Disposable {
  syncClientToTelemetrySetting();
  return vscode.env.onDidChangeTelemetryEnabled(syncClientToTelemetrySetting);
}

function syncClientToTelemetrySetting(): void {
  if (!POSTHOG_API_KEY) {
    return;
  }
  if (vscode.env.isTelemetryEnabled && !client) {
    client = new PostHog(POSTHOG_API_KEY, { host: "https://us.i.posthog.com", flushAt: 1, flushInterval: 0 });
    // Re-identify an already-known user so a client created after a mid-session
    // toggle-on behaves like one created at startup. Alias is server-side and
    // guarded by hasAliased, so it must not be replayed here.
    if (userId) {
      client.identify({ distinctId: userId, properties: { organization: orgSlug } });
    }
  } else if (!vscode.env.isTelemetryEnabled && client) {
    void client.shutdown();
    client = undefined;
  }
}

export function identifyUser(userUuid: string, slug: string): void {
  // Stitch the anonymous pre-auth events (captured against the machine id) onto
  // the user, at most once per session. PostHog refuses to re-alias a machine id
  // already linked to another user, so re-aliasing after sign-out is a no-op that
  // just logs an ingestion warning; the guard avoids it.
  if (!hasAliased && client) {
    client.alias({ distinctId: userUuid, alias: vscode.env.machineId });
    hasAliased = true;
  }
  userId = userUuid;
  orgSlug = slug;
  client?.identify({
    distinctId: userUuid,
    properties: { organization: slug },
  });
}

export function resetIdentity(): void {
  userId = undefined;
  orgSlug = undefined;
}

// One PostHog event per action, named '<object> <action>' to match the
// established Buildkite CLI taxonomy. channel mirrors the CLI's own property
// (it sets channel: 'cli') so extension and CLI events can be compared in the
// same project. A few actions keep a compound name or a discriminator prop
// rather than contort into two tokens: 'job log' (target: web|editor),
// 'build view error', and 'support issue' (files a GitHub issue).
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!client) {
    return;
  }
  // Pre-identification events fire against the anonymous machine id; identify()
  // later aliases it to the real user so the auth funnel stays intact.
  client.capture({
    distinctId: userId ?? vscode.env.machineId,
    event,
    properties: { organization: orgSlug, channel: "vscode", ...properties },
  });
}

export function shutdownAnalytics(): Promise<void> {
  return client?.shutdown() ?? Promise.resolve();
}

// Test seam: analytics is a module singleton with no DI, and with an empty
// build-time key no client is ever created. Tests inject a fake to exercise
// the capture/identify/alias paths; resetting the alias flag keeps each test's
// session state isolated.
export function setClientForTesting(testClient: PostHog | undefined): void {
  client = testClient;
  hasAliased = false;
}

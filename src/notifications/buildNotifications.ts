import * as vscode from "vscode";
import { Build, BuildState } from "../api/types";

/**
 * Build states that are considered "completed" and should trigger notifications
 */
const COMPLETED_BUILD_STATES: BuildState[] = [
  "passed",
  "failed",
  "canceled",
  "skipped",
  "not_run",
];

/**
 * Build states that indicate a hard failure (not soft fail)
 */
const HARD_FAILURE_STATES: BuildState[] = ["failed"];

/**
 * Delay to batch notifications that occur simultaneously (e.g., from polling)
 */
const BATCH_DELAY_MS = 500;

/**
 * Maximum number of individual notifications before switching to summary mode
 */
const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

/**
 * Minimal pipeline info needed for notifications
 */
interface PipelineInfo {
  name: string;
  slug: string;
}

interface TrackedBuild {
  build: Build;
  pipeline: PipelineInfo;
  orgSlug: string;
}

interface PendingNotification {
  build: Build;
  pipeline: PipelineInfo;
  orgSlug: string;
}

/**
 * Service that tracks builds and shows notifications when they complete.
 * Integrates with the existing polling mechanisms in the tree view and status bar.
 *
 * Features:
 * - Batches notifications that occur within BATCH_DELAY_MS to prevent notification storms
 * - Shows summary notifications when many builds complete at once
 * - Queues notifications to show them sequentially with user interaction
 */
export class BuildNotificationService {
  private trackedBuilds = new Map<string, TrackedBuild>();
  private notifiedBuilds = new Set<string>(); // Guards against duplicate notifications
  private pendingNotifications: PendingNotification[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private notificationQueue: PendingNotification[] = [];
  private isShowingNotification = false;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("buildkite.notifications")) {
          this.clearTrackedBuilds();
        }
      }),
    );
  }

  /**
   * Track a build for completion notifications.
   * Called when a build is first seen in an active state (running, scheduled, creating, etc.)
   */
  trackBuild(build: Build, pipeline: PipelineInfo, orgSlug: string): void {
    const config = vscode.workspace.getConfiguration("buildkite.notifications");
    const enabled = config.get<boolean>("enabled", true);

    if (!enabled) {
      return;
    }

    const buildKey = this.getBuildKey(orgSlug, pipeline.slug, build.number);

    // Only track if not already tracked
    if (!this.trackedBuilds.has(buildKey)) {
      this.trackedBuilds.set(buildKey, { build, pipeline, orgSlug });
    }
  }

  /**
   * Update build state and queue notification if it has completed.
   * Called during polling when build state changes.
   */
  updateBuildState(
    build: Build,
    pipeline: PipelineInfo,
    orgSlug: string,
  ): void {
    const config = vscode.workspace.getConfiguration("buildkite.notifications");
    const enabled = config.get<boolean>("enabled", true);

    if (!enabled) {
      return;
    }

    const buildKey = this.getBuildKey(orgSlug, pipeline.slug, build.number);
    const tracked = this.trackedBuilds.get(buildKey);

    if (!tracked) {
      // Build wasn't tracked from an active state, but we might still want to notify
      // if it's already completed and user has "notifyOnAllBuilds" enabled
      const notifyOnAll = config.get<boolean>("notifyOnAllBuilds", false);
      if (notifyOnAll && COMPLETED_BUILD_STATES.includes(build.state) && !this.notifiedBuilds.has(buildKey)) {
        this.notifiedBuilds.add(buildKey);
        this.queueNotification(build, pipeline, orgSlug);
      }
      return;
    }

    // Update the tracked build
    tracked.build = build;

    // Check if build has completed and we haven't notified yet
    if (
      !this.notifiedBuilds.has(buildKey) &&
      COMPLETED_BUILD_STATES.includes(build.state)
    ) {
      this.notifiedBuilds.add(buildKey);
      this.queueNotification(build, pipeline, orgSlug);
      // Clean up — the tracked entry has served its purpose
      this.trackedBuilds.delete(buildKey);
    }
  }

  /**
   * Queue a notification and start batching
   */
  private queueNotification(
    build: Build,
    pipeline: PipelineInfo,
    orgSlug: string,
  ): void {
    this.pendingNotifications.push({ build, pipeline, orgSlug });

    // Start or reset batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, BATCH_DELAY_MS);
  }

  /**
   * Process the batch of pending notifications
   */
  private processBatch(): void {
    if (this.pendingNotifications.length === 0) {
      return;
    }

    const batch = [...this.pendingNotifications];
    this.pendingNotifications = [];
    this.batchTimer = null;

    // Filter based on settings
    const config = vscode.workspace.getConfiguration("buildkite.notifications");
    const notifyOnPass = config.get<boolean>("notifyOnPass", true);
    const notifyOnFail = config.get<boolean>("notifyOnFail", true);

    const filteredBatch = batch.filter(({ build }) => {
      const isFailed = HARD_FAILURE_STATES.includes(build.state);
      const isPassed = build.state === "passed";

      if (isFailed) return notifyOnFail;
      if (isPassed) return notifyOnPass;
      // Other terminal states (canceled, skipped, not_run) — treat like failures
      return notifyOnFail;
    });

    if (filteredBatch.length === 0) {
      return;
    }

    // Add to notification queue
    this.notificationQueue.push(...filteredBatch);
    this.processQueue();
  }

  /**
   * Process the notification queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isShowingNotification || this.notificationQueue.length === 0) {
      return;
    }

    this.isShowingNotification = true;

    try {
      // If we have many notifications, show a summary first
      if (this.notificationQueue.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
        await this.showSummaryNotification();
      } else {
        // Show individual notifications one by one
        while (this.notificationQueue.length > 0) {
          const notification = this.notificationQueue.shift()!;
          await this.showIndividualNotification(notification);

          // If there are more pending, pause briefly between notifications
          if (this.notificationQueue.length > 0) {
            await this.delay(100);
          }
        }
      }
    } finally {
      this.isShowingNotification = false;

      // Check if more notifications came in while we were processing
      if (this.notificationQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Show a summary notification for many builds
   */
  private async showSummaryNotification(): Promise<void> {
    const allNotifications = [...this.notificationQueue];
    this.notificationQueue = [];

    const failedCount = allNotifications.filter(({ build }) =>
      HARD_FAILURE_STATES.includes(build.state),
    ).length;
    const passedCount = allNotifications.filter(
      ({ build }) => build.state === "passed",
    ).length;
    const otherCount =
      allNotifications.length - failedCount - passedCount;

    const parts: string[] = [];
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    if (passedCount > 0) parts.push(`${passedCount} passed`);
    if (otherCount > 0) parts.push(`${otherCount} other`);

    const message = `Buildkite: ${allNotifications.length} builds completed (${parts.join(", ")})`;

    let selection: string | undefined;
    if (failedCount > 0) {
      selection = await vscode.window.showErrorMessage(message, "View Builds", "Dismiss");
    } else {
      selection = await vscode.window.showInformationMessage(message, "View Builds", "Dismiss");
    }

    if (selection === "View Builds") {
      // Open quick pick to select which build to view
      const selected = await vscode.window.showQuickPick(
        allNotifications.map(({ build, pipeline, orgSlug }) => ({
          label: `${pipeline.name} #${build.number}`,
          description: build.state,
          detail: build.message
            ? this.truncateMessage(build.message, 60)
            : undefined,
          build,
          pipeline,
          orgSlug,
        })),
        {
          placeHolder: "Select a build to view",
        },
      );

      if (selected) {
        await this.handleNotificationAction(
          "Open in Buildkite",
          selected.build,
          selected.pipeline,
          selected.orgSlug,
        );
      }
    }
  }

  /**
   * Show an individual notification
   */
  private async showIndividualNotification(
    notification: PendingNotification,
  ): Promise<void> {
    const { build, pipeline, orgSlug } = notification;

    const isFailed = HARD_FAILURE_STATES.includes(build.state);
    const isPassed = build.state === "passed";

    const stateLabel = build.state.charAt(0).toUpperCase() + build.state.slice(1);
    const commitMsg = build.message
      ? ` "${this.truncateMessage(build.message, 50)}"`
      : "";
    const message = `Buildkite: ${pipeline.name} #${build.number} ${stateLabel}${commitMsg}`;

    const buttons = isFailed
      ? ["View Error", "Open in Buildkite"]
      : ["Open in Buildkite"];

    let selection: string | undefined;

    if (isFailed) {
      selection = await vscode.window.showErrorMessage(message, ...buttons);
    } else if (isPassed) {
      selection = await vscode.window.showInformationMessage(message, ...buttons);
    } else {
      selection = await vscode.window.showWarningMessage(message, ...buttons);
    }

    await this.handleNotificationAction(selection, build, pipeline, orgSlug);
  }

  /**
   * Handle notification button clicks
   */
  private async handleNotificationAction(
    selection: string | undefined,
    build: Build,
    pipeline: PipelineInfo,
    orgSlug: string,
  ): Promise<void> {
    if (!selection) {
      return;
    }

    switch (selection) {
      case "View Error":
        await vscode.commands.executeCommand("buildkite.build.viewError", {
          build,
          pipeline,
          orgSlug,
        });
        break;

      case "Open in Buildkite":
        await vscode.env.openExternal(vscode.Uri.parse(build.web_url));
        break;
    }
  }

  /**
   * Clear all tracked builds (e.g., when configuration changes)
   */
  clearTrackedBuilds(): void {
    this.trackedBuilds.clear();
    this.notifiedBuilds.clear();
    this.pendingNotifications = [];
    this.notificationQueue = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Get a unique key for a build
   */
  private getBuildKey(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): string {
    return `${orgSlug}/${pipelineSlug}#${buildNumber}`;
  }

  /**
   * Truncate a message to a maximum length
   */
  private truncateMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + "...";
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  dispose(): void {
    this.clearTrackedBuilds();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

// Global instance
let notificationServiceInstance: BuildNotificationService | undefined;

export function initBuildNotifications(): BuildNotificationService {
  notificationServiceInstance = new BuildNotificationService();
  return notificationServiceInstance;
}

export function getBuildNotificationService():
  | BuildNotificationService
  | undefined {
  return notificationServiceInstance;
}

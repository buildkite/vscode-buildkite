import * as vscode from "vscode";
import { GitExtension, API as GitAPI } from "../types/git";
import { CachedApiClient } from "../cache/cachedApiClient";
import { AuthManager } from "../api/auth";
import { Pipeline, Build, BuildState } from "../api/types";
import { getGitUrlVariants } from "../utils/gitUrl";
import { getIconForBuild, getAggregateIcon } from "../treeViews/icons";
import { showPipelineQuickPick } from "./statusBarCommands";
import { error, redactIfCredentialShaped, warn } from "../log";

const ACTIVE_POLL_INTERVAL_MS = 60000; // 60 seconds when builds are running
const IDLE_POLL_INTERVAL_MS = 60000; // 60 seconds when idle (to catch new builds)

const ACTIVE_BUILD_STATES: BuildState[] = [
  "running",
  "scheduled",
  "creating",
  "canceling",
];

let statusBarManagerInstance: StatusBarManager | undefined;

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private client: CachedApiClient;
  private workspaceRemoteUrls: string[] = [];
  private matchedPipelines: Pipeline[] = [];
  private pipelineBuilds: Map<string, Build[]> = new Map();
  private hasToken = false;
  private orgSlug: string | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly authManager: AuthManager,
    client: CachedApiClient,
  ) {
    this.client = client;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = "buildkite.statusBar.showPipelines";
    this.statusBarItem.name = "Buildkite Build Status";
  }

  async initialize(): Promise<void> {
    // Listen for workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        await this.detectWorkspaceRemotes();
        await this.refresh();
      }),
    );

    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("buildkite.statusBar")) {
          this.renderStatusBar();
        }
      }),
    );

    // Get git API and set up repository listeners
    const gitApi = await this.getGitApi();
    if (gitApi) {
      this.disposables.push(
        gitApi.onDidOpenRepository(async () => {
          await this.detectWorkspaceRemotes();
          await this.refresh();
        }),
        gitApi.onDidCloseRepository(async () => {
          await this.detectWorkspaceRemotes();
          await this.refresh();
        }),
      );

      // If no repositories yet, wait for one to open
      if (gitApi.repositories.length === 0) {
        this.renderStatusBar(); // Show initial state
        return; // onDidOpenRepository will trigger refresh
      }
    }

    await this.detectWorkspaceRemotes();
    await this.refresh();
  }

  private async getGitApi(): Promise<GitAPI | undefined> {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
      return undefined;
    }
    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }
    const api = gitExtension.exports.getAPI(1);

    // Wait for the Git API to be fully initialized (repositories discovered)
    if (api.state === "uninitialized") {
      await new Promise<void>((resolve) => {
        const disposable = api.onDidChangeState((state) => {
          if (state === "initialized") {
            disposable.dispose();
            resolve();
          }
        });
      });
    }

    return api;
  }

  private async detectWorkspaceRemotes(): Promise<void> {
    const gitApi = await this.getGitApi();
    if (!gitApi) {
      this.workspaceRemoteUrls = [];
      return;
    }

    const remotes: string[] = [];
    for (const repo of gitApi.repositories) {
      // Wait for repository state to be populated if remotes are empty
      if (repo.state.remotes.length === 0) {
        await this.waitForRepositoryState(repo);
      }

      for (const remote of repo.state.remotes) {
        if (remote.fetchUrl) {
          remotes.push(remote.fetchUrl);
        }
        if (remote.pushUrl && remote.pushUrl !== remote.fetchUrl) {
          remotes.push(remote.pushUrl);
        }
      }
    }
    this.workspaceRemoteUrls = remotes;
  }

  private waitForRepositoryState(repo: import("../types/git").Repository): Promise<void> {
    return new Promise((resolve) => {
      // If already has remotes, resolve immediately
      if (repo.state.remotes.length > 0) {
        resolve();
        return;
      }

      const disposable = repo.state.onDidChange(() => {
        if (repo.state.remotes.length > 0) {
          clearTimeout(timer);
          disposable.dispose();
          resolve();
        }
      });

      const timer = setTimeout(() => {
        disposable.dispose();
        warn("[StatusBar] timed out waiting for git repository remotes");
        resolve();
      }, 5000);
    });
  }

  async refresh(): Promise<void> {
    const token = (await this.authManager.resolveSession())?.token;
    this.hasToken = token !== undefined;
    if (!token) {
      this.matchedPipelines = [];
      this.pipelineBuilds.clear();
      this.stopPolling();
      this.renderStatusBar();
      return;
    }

    try {
      const org = await this.client.getOrganization();
      this.orgSlug = org.slug;

      await this.findMatchingPipelinesAndBuilds();
      this.renderStatusBar();
      this.managePolling();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
      error(`[StatusBar] error: ${redactIfCredentialShaped(message + stack)}`);
      this.matchedPipelines = [];
      this.pipelineBuilds.clear();
      this.stopPolling();
      this.renderStatusBar();
    }
  }

  private async findMatchingPipelinesAndBuilds(): Promise<void> {
    if (!this.orgSlug || this.workspaceRemoteUrls.length === 0) {
      this.matchedPipelines = [];
      this.pipelineBuilds.clear();
      return;
    }

    const seenSlugs = new Set<string>();
    const pipelines: Pipeline[] = [];

    this.pipelineBuilds.clear();

    // Generate URL variants (SSH, HTTPS, with/without .git) to match
    // pipelines regardless of how they're configured in Buildkite
    const urlVariants = new Set<string>();
    for (const remoteUrl of this.workspaceRemoteUrls) {
      for (const variant of getGitUrlVariants(remoteUrl)) {
        urlVariants.add(variant);
      }
    }

    const orgSlug = this.orgSlug;
    const allResults = await Promise.all(
      [...urlVariants].map(async (repoUrl) => {
        try {
          return await this.client.getPipelinesByRepository(
            orgSlug,
            repoUrl,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warn(`[StatusBar] Failed to fetch pipelines for ${repoUrl}: ${redactIfCredentialShaped(message)}`);
          return [];
        }
      }),
    );

    for (const results of allResults) {
      for (const { pipeline, builds } of results) {
        // Avoid duplicates if multiple URL variants match the same pipeline
        if (!seenSlugs.has(pipeline.slug)) {
          seenSlugs.add(pipeline.slug);
          pipelines.push(pipeline);
          if (builds.length > 0) {
            this.pipelineBuilds.set(pipeline.slug, builds);
          }
        }
      }
    }

    this.matchedPipelines = pipelines;
  }

  private renderStatusBar(): void {
    const config = vscode.workspace.getConfiguration("buildkite.statusBar");
    const showWhenNoMatch = config.get<boolean>("showWhenNoMatch", false);

    if (!this.hasToken) {
      this.statusBarItem.text = "$(key) Buildkite";
      this.statusBarItem.tooltip = "Click to sign in to Buildkite";
      this.statusBarItem.show();
      return;
    }

    // No matching pipelines
    if (this.matchedPipelines.length === 0) {
      if (showWhenNoMatch) {
        this.statusBarItem.text = "$(question) No pipeline";
        this.statusBarItem.tooltip =
          "No Buildkite pipeline found matching this workspace";
        this.statusBarItem.show();
      } else {
        this.statusBarItem.hide();
      }
      return;
    }

    // Use only the latest build per pipeline for aggregate status
    const latestBuilds = Array.from(this.pipelineBuilds.values())
      .map((builds) => builds[0])
      .filter((b): b is Build => b !== undefined);

    // Single pipeline - show latest build info
    if (this.matchedPipelines.length === 1) {
      const pipelineBuilds =
        this.pipelineBuilds.get(this.matchedPipelines[0].slug) || [];
      const latestBuild = pipelineBuilds[0];
      if (latestBuild) {
        const icon = getIconForBuild(latestBuild.state);
        this.statusBarItem.text = `$(${icon}) #${latestBuild.number} ${latestBuild.state}`;
        this.statusBarItem.tooltip = this.createSingleBuildTooltip(
          this.matchedPipelines[0],
          latestBuild,
        );
        this.statusBarItem.show();
        return;
      }
    }

    // Multiple pipelines - show aggregate status
    const icon = getAggregateIcon(latestBuilds);
    const { text, tooltip } = this.getAggregateDisplay(latestBuilds);
    this.statusBarItem.text = `$(${icon}) ${text}`;
    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.show();
  }

  private createSingleBuildTooltip(pipeline: Pipeline, build: Build): string {
    const lines = [
      `**${pipeline.name}**`,
      `Build #${build.number} - ${build.state}`,
      `Branch: ${build.branch}`,
      build.message ? `"${build.message}"` : "",
      "",
      "Click to view options",
    ];
    return lines.filter(Boolean).join("\n");
  }

  private getAggregateDisplay(builds: Build[]): { text: string; tooltip: string } {
    const total = this.matchedPipelines.length;
    const failedCount = builds.filter((b) => b.state === "failed").length;
    const runningCount = builds.filter((b) =>
      ACTIVE_BUILD_STATES.includes(b.state),
    ).length;

    let text: string;
    if (failedCount > 0) {
      text = `${failedCount}/${total} failing`;
    } else if (runningCount > 0) {
      text = `${runningCount} running`;
    } else {
      text = `${total} pipelines`;
    }

    const tooltipLines = [
      `**${total} Buildkite pipelines**`,
      "",
      ...this.matchedPipelines.map((p) => {
        const builds = this.pipelineBuilds.get(p.slug);
        if (builds && builds.length > 0) {
          return `- ${p.name}: #${builds[0].number} ${builds[0].state}`;
        }
        return `- ${p.name}: no builds`;
      }),
      "",
      "Click to view options",
    ];

    return { text, tooltip: tooltipLines.join("\n") };
  }

  private managePolling(): void {
    // Always poll, but adjust interval based on whether builds are active
    const allBuilds = Array.from(this.pipelineBuilds.values()).flat();
    const hasActiveBuilds = allBuilds.some((b) =>
      ACTIVE_BUILD_STATES.includes(b.state),
    );

    const desiredInterval = hasActiveBuilds
      ? ACTIVE_POLL_INTERVAL_MS
      : IDLE_POLL_INTERVAL_MS;

    // Only restart polling if interval needs to change or not running
    if (this.pollTimer && this.currentPollInterval === desiredInterval) {
      return;
    }

    this.stopPolling();
    this.startPolling(desiredInterval);
  }

  private currentPollInterval: number | undefined;

  private startPolling(interval: number): void {
    if (this.pollTimer) {
      return;
    }
    this.currentPollInterval = interval;
    this.pollTimer = setInterval(async () => {
      await this.findMatchingPipelinesAndBuilds();
      this.renderStatusBar();
      this.managePolling(); // Adjust interval if build states changed
    }, interval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      this.currentPollInterval = undefined;
    }
  }

  async showQuickPick(): Promise<void> {
    const token = (await this.authManager.resolveSession())?.token;
    if (!token) {
      await vscode.commands.executeCommand("buildkite.signIn");
      return;
    }

    // Re-detect remotes and refresh pipelines when command is invoked
    await this.detectWorkspaceRemotes();
    await this.refresh();

    // Handle no matching pipelines
    if (this.matchedPipelines.length === 0) {
      vscode.window.showInformationMessage(
        "No Buildkite pipelines found matching this workspace's git remote.",
      );
      return;
    }

    await showPipelineQuickPick(
      this.matchedPipelines,
      this.pipelineBuilds,
      this.orgSlug!,
      this.client,
    );
  }

  dispose(): void {
    this.stopPolling();
    this.statusBarItem.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

export function initStatusBar(
  context: vscode.ExtensionContext,
  authManager: AuthManager,
  client: CachedApiClient,
): void {
  statusBarManagerInstance = new StatusBarManager(authManager, client);
  // initialize() touches git API discovery and workspace remote detection,
  // both of which can reject, so surface failures to the console rather
  // than letting them become silent unhandled rejections
  void statusBarManagerInstance.initialize().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
    error(`[StatusBar] initialization failed: ${redactIfCredentialShaped(message + stack)}`);
  });

  context.subscriptions.push(statusBarManagerInstance);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "buildkite.statusBar.showPipelines",
      async () => {
        await statusBarManagerInstance?.showQuickPick();
      },
    ),
  );
}

export function getStatusBarManager(): StatusBarManager | undefined {
  return statusBarManagerInstance;
}

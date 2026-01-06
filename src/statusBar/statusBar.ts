import * as vscode from "vscode";
import { GitExtension, API as GitAPI } from "../types/git";
import { BuildkiteClient } from "../api/client";
import { AuthManager } from "../api/auth";
import { Pipeline, Build, BuildState } from "../api/types";
import { gitUrlsMatch } from "../utils/gitUrl";
import { getIconForBuild, getAggregateIcon } from "../treeViews/icons";
import { showPipelineQuickPick } from "./statusBarCommands";

const POLL_INTERVAL_MS = 10000; // 10 seconds

const ACTIVE_BUILD_STATES: BuildState[] = [
  "running",
  "scheduled",
  "creating",
  "canceling",
];

let statusBarManagerInstance: StatusBarManager | undefined;

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private client: BuildkiteClient;
  private workspaceRemoteUrls: string[] = [];
  private matchedPipelines: Pipeline[] = [];
  private latestBuilds: Map<string, Build> = new Map();
  private orgSlug: string | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.client = new BuildkiteClient();
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = "buildkite.statusBar.showPipelines";
    this.statusBarItem.name = "Buildkite Build Status";
  }

  async initialize(): Promise<void> {
    await this.detectWorkspaceRemotes();
    await this.refresh();

    // Listen for workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        await this.detectWorkspaceRemotes();
        await this.refresh();
      }),
    );

    // Listen for git extension repository changes
    const gitApi = this.getGitApi();
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
    }

    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("buildkite.statusBar")) {
          this.renderStatusBar();
        }
      }),
    );
  }

  private getGitApi(): GitAPI | undefined {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
      return undefined;
    }
    if (!gitExtension.isActive) {
      return undefined;
    }
    return gitExtension.exports.getAPI(1);
  }

  private async detectWorkspaceRemotes(): Promise<void> {
    const gitApi = this.getGitApi();
    if (!gitApi) {
      this.workspaceRemoteUrls = [];
      return;
    }

    const remotes: string[] = [];
    for (const repo of gitApi.repositories) {
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

  async refresh(): Promise<void> {
    // Check if we have a token
    const token = await AuthManager.getToken();
    if (!token) {
      this.matchedPipelines = [];
      this.latestBuilds.clear();
      this.stopPolling();
      this.renderStatusBar();
      return;
    }

    try {
      const org = await this.client.getOrganization();
      this.orgSlug = org.slug;

      await this.findMatchingPipelines();
      await this.fetchLatestBuilds();
      this.renderStatusBar();
      this.managePolling();
    } catch (error) {
      console.error("Buildkite status bar error:", error);
      this.matchedPipelines = [];
      this.latestBuilds.clear();
      this.stopPolling();
      this.renderStatusBar();
    }
  }

  private async findMatchingPipelines(): Promise<void> {
    if (!this.orgSlug || this.workspaceRemoteUrls.length === 0) {
      this.matchedPipelines = [];
      return;
    }

    const pipelines = await this.client.getPipelines(this.orgSlug);
    this.matchedPipelines = pipelines.filter((pipeline) =>
      this.workspaceRemoteUrls.some((remoteUrl) =>
        gitUrlsMatch(remoteUrl, pipeline.repository),
      ),
    );
  }

  private async fetchLatestBuilds(): Promise<void> {
    if (!this.orgSlug) {
      return;
    }

    this.latestBuilds.clear();

    for (const pipeline of this.matchedPipelines) {
      try {
        const builds = await this.client.getBuilds(
          this.orgSlug,
          pipeline.slug,
          1,
        );
        if (builds.length > 0) {
          this.latestBuilds.set(pipeline.slug, builds[0]);
        }
      } catch (error) {
        console.error(
          `Failed to fetch builds for pipeline ${pipeline.slug}:`,
          error,
        );
      }
    }
  }

  private renderStatusBar(): void {
    const config = vscode.workspace.getConfiguration("buildkite.statusBar");
    const showWhenNoMatch = config.get<boolean>("showWhenNoMatch", false);

    // Check if we have a token
    const hasToken = AuthManager.getToken() !== undefined;

    // No token state
    if (!hasToken) {
      this.statusBarItem.text = "$(key) Buildkite";
      this.statusBarItem.tooltip = "Click to set Buildkite API token";
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

    const builds = Array.from(this.latestBuilds.values());

    // Single pipeline
    if (this.matchedPipelines.length === 1 && builds.length === 1) {
      const build = builds[0];
      const icon = getIconForBuild(build.state);
      this.statusBarItem.text = `$(${icon}) #${build.number} ${build.state}`;
      this.statusBarItem.tooltip = this.createSingleBuildTooltip(
        this.matchedPipelines[0],
        build,
      );
      this.statusBarItem.show();
      return;
    }

    // Multiple pipelines - show aggregate status
    const icon = getAggregateIcon(builds);
    const { text, tooltip } = this.getAggregateDisplay(builds);
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
        const build = this.latestBuilds.get(p.slug);
        if (build) {
          return `- ${p.name}: #${build.number} ${build.state}`;
        }
        return `- ${p.name}: no builds`;
      }),
      "",
      "Click to view options",
    ];

    return { text, tooltip: tooltipLines.join("\n") };
  }

  private managePolling(): void {
    const builds = Array.from(this.latestBuilds.values());
    const hasActiveBuilds = builds.some((b) =>
      ACTIVE_BUILD_STATES.includes(b.state),
    );

    if (hasActiveBuilds && !this.pollTimer) {
      this.startPolling();
    } else if (!hasActiveBuilds && this.pollTimer) {
      this.stopPolling();
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(async () => {
      await this.fetchLatestBuilds();
      this.renderStatusBar();
      this.managePolling();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async showQuickPick(): Promise<void> {
    // Handle no token case
    const token = await AuthManager.getToken();
    if (!token) {
      const action = await vscode.window.showQuickPick(
        [{ label: "Set API Token", description: "Configure your Buildkite API token" }],
        { placeHolder: "Buildkite API token not configured" },
      );
      if (action) {
        vscode.commands.executeCommand("buildkite.setToken");
      }
      return;
    }

    // Handle no matching pipelines
    if (this.matchedPipelines.length === 0) {
      vscode.window.showInformationMessage(
        "No Buildkite pipelines found matching this workspace's git remote.",
      );
      return;
    }

    await showPipelineQuickPick(
      this.matchedPipelines,
      this.latestBuilds,
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

export function initStatusBar(context: vscode.ExtensionContext): void {
  statusBarManagerInstance = new StatusBarManager();
  statusBarManagerInstance.initialize();

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

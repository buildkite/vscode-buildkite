import * as vscode from "vscode";
import { PipelinesTreeProvider } from "./pipelines";
import { AgentsTreeProvider } from "./agents";
import { PipelineTreeNode } from "./pipelines";
import { SupportViewProvider } from "./support";
import { AuthManager } from "../api/auth";
import { CachedApiClient } from "../cache/cachedApiClient";
import { track } from "../analytics/analytics";
import { getGitApi } from "../utils/workspaceRemotes";

// workspaceState key remembering the pipelines view's workspace-filter toggle
const WORKSPACE_FILTER_STATE_KEY = "buildkite.pipelines.workspaceFilter";

let pipelinesTreeProvider: PipelinesTreeProvider;
let agentsTreeProvider: AgentsTreeProvider;
let pipelinesTreeView: vscode.TreeView<PipelineTreeNode>;

export function initTreeViews(
  context: vscode.ExtensionContext,
  authManager: AuthManager,
  client: CachedApiClient,
): void {
  pipelinesTreeProvider = new PipelinesTreeProvider(authManager, client);
  agentsTreeProvider = new AgentsTreeProvider(authManager, client);

  pipelinesTreeView = vscode.window.createTreeView("buildkite.pipelines", {
    treeDataProvider: pipelinesTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(pipelinesTreeView);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "buildkite.agents",
      agentsTreeProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "buildkite.pipelines.refresh",
      async () => {
        track("pipeline refresh");
        await pipelinesTreeProvider.refresh();
      },
    ),
  );

  // Workspace filter: per-workspace persistence, falling back to the setting
  // for the initial default in workspaces where it was never toggled
  const setWorkspaceFilter = async (enabled: boolean): Promise<void> => {
    pipelinesTreeProvider.setWorkspaceFilter(enabled);
    await context.workspaceState.update(WORKSPACE_FILTER_STATE_KEY, enabled);
    await vscode.commands.executeCommand(
      "setContext",
      "buildkite.pipelines.workspaceFilterActive",
      enabled,
    );
  };

  const initialFilter = context.workspaceState.get<boolean>(
    WORKSPACE_FILTER_STATE_KEY,
    vscode.workspace
      .getConfiguration("buildkite.pipelines")
      .get<boolean>("filterToWorkspaceByDefault", false),
  );
  void setWorkspaceFilter(initialFilter);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "buildkite.pipelines.filterToWorkspace",
      async () => {
        track("pipeline workspace filter", { enabled: true });
        await setWorkspaceFilter(true);
      },
    ),
    vscode.commands.registerCommand(
      "buildkite.pipelines.showAll",
      async () => {
        track("pipeline workspace filter", { enabled: false });
        await setWorkspaceFilter(false);
      },
    ),
  );

  // Repositories opening/closing change what the filter matches
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() =>
      pipelinesTreeProvider.onWorkspaceChanged(),
    ),
  );
  void getGitApi().then((gitApi) => {
    if (!gitApi) {
      return;
    }
    context.subscriptions.push(
      gitApi.onDidOpenRepository(() => pipelinesTreeProvider.onWorkspaceChanged()),
      gitApi.onDidCloseRepository(() => pipelinesTreeProvider.onWorkspaceChanged()),
    );
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.agents.refresh", async () => {
      track("agent refresh");
      await agentsTreeProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SupportViewProvider.viewId,
      new SupportViewProvider(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.openSupportEmail", () => {
      track("support contact");
      vscode.env.openExternal(vscode.Uri.parse("mailto:support@buildkite.com"));
    }),
    vscode.commands.registerCommand("buildkite.raiseIssue", () => {
      track("support issue");
      vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/buildkite/vscode-buildkite/issues/new"),
      );
    }),
  );

  // Register dispose to clean up polling timers
  context.subscriptions.push({
    dispose: () => {
      pipelinesTreeProvider.dispose();
      agentsTreeProvider.dispose();
    },
  });
}

export function getPipelinesTreeView(): vscode.TreeView<PipelineTreeNode> {
  if (!pipelinesTreeView) {
    throw new Error("Tree view not initialized. Call initTreeViews first.");
  }
  return pipelinesTreeView;
}

export function getPipelinesTreeProvider(): PipelinesTreeProvider {
  if (!pipelinesTreeProvider) {
    throw new Error("Tree provider not initialized. Call initTreeViews first.");
  }
  return pipelinesTreeProvider;
}

export function getAgentsTreeProvider(): AgentsTreeProvider {
  if (!agentsTreeProvider) {
    throw new Error("Tree provider not initialized. Call initTreeViews first.");
  }
  return agentsTreeProvider;
}

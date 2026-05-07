import * as vscode from "vscode";
import { PipelinesTreeProvider } from "./pipelines";
import { AgentsTreeProvider } from "./agents";
import { PipelineTreeNode } from "./pipelines";
import { SupportViewProvider } from "./support";
import { AuthManager } from "../api/auth";

let pipelinesTreeProvider: PipelinesTreeProvider;
let agentsTreeProvider: AgentsTreeProvider;
let pipelinesTreeView: vscode.TreeView<PipelineTreeNode>;

export function initTreeViews(context: vscode.ExtensionContext, authManager: AuthManager): void {
  pipelinesTreeProvider = new PipelinesTreeProvider(authManager);
  agentsTreeProvider = new AgentsTreeProvider(authManager);

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
        await pipelinesTreeProvider.refresh();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.agents.refresh", async () => {
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
      vscode.env.openExternal(
        vscode.Uri.parse("mailto:support@buildkite.com"),
      );
    }),
  );

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

import * as vscode from "vscode";
import { PipelinesTreeProvider } from "./pipelines";
import { AgentsTreeProvider } from "./agents";

let pipelinesTreeProvider: PipelinesTreeProvider;
let agentsTreeProvider: AgentsTreeProvider;

export function initTreeViews(context: vscode.ExtensionContext): void {
  pipelinesTreeProvider = new PipelinesTreeProvider();
  agentsTreeProvider = new AgentsTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "buildkite.pipelines",
      pipelinesTreeProvider,
    ),
  );

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

  // Register dispose to clean up polling timers and caches
  context.subscriptions.push({
    dispose: () => {
      pipelinesTreeProvider.dispose();
      agentsTreeProvider.dispose();
    },
  });
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

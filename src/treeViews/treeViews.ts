import * as vscode from "vscode";
import { PipelinesTreeProvider } from "./pipelines";

let pipelinesTreeProvider: PipelinesTreeProvider;

export function initTreeViews(context: vscode.ExtensionContext): void {
  pipelinesTreeProvider = new PipelinesTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "buildkite.pipelines",
      pipelinesTreeProvider,
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

  // Register dispose to clean up polling timers
  context.subscriptions.push({
    dispose: () => {
      pipelinesTreeProvider.dispose();
    },
  });
}

export function getPipelinesTreeProvider(): PipelinesTreeProvider {
  if (!pipelinesTreeProvider) {
    throw new Error("Tree provider not initialized. Call initTreeViews first.");
  }
  return pipelinesTreeProvider;
}

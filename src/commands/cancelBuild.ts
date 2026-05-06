import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function cancelBuild(client: BuildkiteClient, node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  // Allow canceling builds that are blocked or in active states
  const cancelableStates = ["creating", "scheduled", "running", "failing", "blocked"];
  if (!node.build.blocked && !cancelableStates.includes(node.build.state)) {
    vscode.window.showErrorMessage(
      `Cannot cancel build in state: ${node.build.state}`,
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Cancel build #${node.build.number} (${node.build.state}) on ${node.pipeline.name}?`,
    { modal: true },
    "Cancel Build",
  );

  if (confirmation !== "Cancel Build") {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Canceling build #${node.build.number}...`,
        cancellable: false,
      },
      async () => {
        await client.cancelBuild(node.orgSlug, node.pipeline.slug, node.build.number);
      },
    );

    vscode.window.showInformationMessage(
      `Build #${node.build.number} has been canceled`,
    );

    // Refresh the tree to show the updated build state
    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to cancel build: ${error.message}`);
    }
  }
}

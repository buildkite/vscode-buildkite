import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function retryBuild(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Retry build #${node.build.number} on ${node.pipeline.name}?`,
    { modal: true },
    "Retry",
  );

  if (confirmation !== "Retry") {
    return;
  }

  try {
    const client = new BuildkiteClient();
    await client.retryBuild(node.orgSlug, node.pipeline.slug, node.build.number);

    vscode.window.showInformationMessage(
      `Build #${node.build.number} has been queued for retry`,
    );

    // Refresh the tree to show the new build
    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to retry build: ${error.message}`);
    }
  }
}

import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function cancelBuild(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Cancel build #${node.build.number} on ${node.pipeline.name}?`,
    { modal: true },
    "Cancel Build",
  );

  if (confirmation !== "Cancel Build") {
    return;
  }

  try {
    const client = new BuildkiteClient();
    await client.cancelBuild(node.orgSlug, node.pipeline.slug, node.build.number);

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

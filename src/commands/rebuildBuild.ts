import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function rebuildBuild(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Rebuild #${node.build.number} on ${node.pipeline.name}?`,
    { modal: true },
    "Rebuild",
  );

  if (confirmation !== "Rebuild") {
    return;
  }

  try {
    const client = CachedApiClient.getInstance();
    await client.rebuildBuild(node.orgSlug, node.pipeline.slug, node.build.number);

    vscode.window.showInformationMessage(
      `Build #${node.build.number} has been queued for rebuild`,
    );

    // Refresh the tree to show the new build
    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to rebuild: ${error.message}`);
    }
  }
}

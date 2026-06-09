import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";
import { track } from "../analytics/analytics";

export async function rebuildBuild(client: CachedApiClient, node: BuildNode): Promise<void> {
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
    await client.rebuildBuild(node.orgSlug, node.pipeline.slug, node.build.number);
    track("build rebuild", { pipeline_uuid: node.pipeline.id, build_uuid: node.build.id });

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

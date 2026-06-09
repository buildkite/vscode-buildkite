import * as vscode from "vscode";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { track } from "../analytics/analytics";

export async function openBuildUrl(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  const uri = vscode.Uri.parse(node.build.web_url);
  await vscode.env.openExternal(uri);
  track("build view", { pipeline_uuid: node.pipeline.id, build_uuid: node.build.id, source: "tree" });

}

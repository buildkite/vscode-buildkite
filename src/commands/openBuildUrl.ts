import * as vscode from "vscode";
import { BuildNode } from "../treeViews/nodes/buildNode";

export async function openBuildUrl(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  const uri = vscode.Uri.parse(node.build.web_url);
  await vscode.env.openExternal(uri);
}

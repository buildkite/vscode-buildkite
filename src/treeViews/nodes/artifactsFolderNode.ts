import * as vscode from "vscode";
import { Pipeline } from "../../api/types";

export class ArtifactsFolderNode extends vscode.TreeItem {
  constructor(
    public readonly buildNumber: number,
    public readonly pipeline: Pipeline,
    public readonly orgSlug: string,
    public readonly buildUuid: string,
  ) {
    super("Artifacts", vscode.TreeItemCollapsibleState.Collapsed);

    this.iconPath = new vscode.ThemeIcon("package");
    this.contextValue = "artifactsFolder";
  }
}

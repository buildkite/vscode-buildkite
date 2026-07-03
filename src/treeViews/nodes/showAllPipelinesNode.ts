import * as vscode from "vscode";

// Fallback action shown when the workspace filter matches no pipelines, so an
// empty view always offers a one-click way out of the filtered state.
export class ShowAllPipelinesNode extends vscode.TreeItem {
  constructor() {
    super("Show all pipelines", vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("list-flat");
    this.tooltip = "Show every pipeline in the organization";
    this.contextValue = "showAllPipelines";
    this.command = {
      command: "buildkite.pipelines.showAll",
      title: "Show All Pipelines",
    };
  }
}

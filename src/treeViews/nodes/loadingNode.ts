import * as vscode from "vscode";

export class LoadingNode extends vscode.TreeItem {
  constructor(message = "Loading...") {
    super(message, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("loading~spin");
    this.tooltip = message;
    this.contextValue = "loading";
  }
}

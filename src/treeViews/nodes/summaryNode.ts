import * as vscode from "vscode";

export class SummaryNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("info");
    this.tooltip = message;
    this.contextValue = "info";
  }
}

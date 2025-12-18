import * as vscode from "vscode";

export class ErrorNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("error");
    this.tooltip = message;
    this.contextValue = "error";
  }
}

import * as vscode from "vscode";

export class NoTokenNode extends vscode.TreeItem {
  constructor() {
    super("Sign in to Buildkite", vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("key");
    this.tooltip = "Click to set your Buildkite API token";
    this.contextValue = "noToken";

    this.command = {
      command: "buildkite.setToken",
      title: "Set API Token",
    };
  }
}

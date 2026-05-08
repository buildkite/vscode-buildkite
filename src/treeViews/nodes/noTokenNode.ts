import * as vscode from "vscode";

export class NoTokenNode extends vscode.TreeItem {
  constructor() {
    super("Sign in to Buildkite", vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("sign-in");
    this.tooltip = "Sign in via browser or use an API token";
    this.contextValue = "noCredential";

    this.command = {
      command: "buildkite.signIn",
      title: "Sign in to Buildkite",
    };
  }
}

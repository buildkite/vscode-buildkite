import * as vscode from "vscode";

export class ViewAllStepsNode extends vscode.TreeItem {
  // If we have more than 40 jobs
  // show a "View all X steps on Buildkite" node that opens a link in a browser
  constructor(url: string, jobCount: number) {
    const linkText = `View all ${jobCount} steps on Buildkite`;
    super(linkText, vscode.TreeItemCollapsibleState.None);

    this.command = {
      command: "vscode.open",
      title: "Open in Buildkite",
      arguments: [vscode.Uri.parse(url)],
    };
  }
}
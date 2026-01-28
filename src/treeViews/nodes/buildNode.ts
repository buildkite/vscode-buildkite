import * as vscode from "vscode";
import { Build, Pipeline } from "../../api/types";
import { getIconForBuild } from "../icons";

export class BuildNode extends vscode.TreeItem {
  constructor(
    public readonly build: Build,
    public readonly pipeline: Pipeline,
    public readonly orgSlug: string,
  ) {
    super(BuildNode.getLabel(build), vscode.TreeItemCollapsibleState.None);

    // Show lock icon for blocked builds, regardless of state
    const iconName = this.build.blocked ? "lock" : getIconForBuild(build.state);
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.tooltip = this.getTooltip();
    this.contextValue = this.build.blocked ? "build:blocked" : "build";

    this.command = {
      command: "buildkite.build.open",
      title: "Open Build",
      arguments: [this],
    };
  }

  private static getLabel(build: Build): string {
    return `#${build.number} - ${build.branch}`;
  }

  private getTooltip(): string {
    const lines = [
      `Build #${this.build.number}`,
      `State: ${this.build.state}`,
      `Blocked: ${this.build.blocked ? "Yes" : "No"}`,
      `Branch: ${this.build.branch}`,
    ];

    if (this.build.message) {
      lines.push(`Message: ${this.build.message}`);
    }

    if (this.build.creator) {
      lines.push(`Creator: ${this.build.creator.name}`);
    }

    if (this.build.started_at) {
      lines.push(`Started: ${new Date(this.build.started_at).toLocaleString()}`);
    }

    if (this.build.finished_at) {
      lines.push(
        `Finished: ${new Date(this.build.finished_at).toLocaleString()}`,
      );
    }

    return lines.join("\n");
  }
}

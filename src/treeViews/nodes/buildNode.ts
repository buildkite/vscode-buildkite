import * as vscode from "vscode";
import { Build, Pipeline } from "../../api/types";
import { getIconForBuild } from "../icons";

export class BuildNode extends vscode.TreeItem {
  constructor(
    public readonly build: Build,
    public readonly pipeline: Pipeline,
    public readonly orgSlug: string,
  ) {
    // Make build nodes collapsible to show jobs
    super(BuildNode.getLabel(build), vscode.TreeItemCollapsibleState.Collapsed);

    this.iconPath = new vscode.ThemeIcon(getIconForBuild(build.state));
    this.tooltip = this.getTooltip();
    this.contextValue = `build-${build.state}`;

    // Remove the default command so clicking the node expands it to show jobs
    // Users can still use context menu to open the build URL
  }

  private static getLabel(build: Build): string {
    return `#${build.number} - ${build.branch}`;
  }

  private getTooltip(): string {
    const lines = [
      `Build #${this.build.number}`,
      `State: ${this.build.state}`,
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

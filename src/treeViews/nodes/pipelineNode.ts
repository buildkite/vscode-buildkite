import * as vscode from "vscode";
import { Pipeline } from "../../api/types";

export class PipelineNode extends vscode.TreeItem {
  constructor(
    public readonly pipeline: Pipeline,
    public readonly orgSlug: string,
  ) {
    super(pipeline.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.contextValue = "pipeline";
  }

  private getDescription(): string {
    const parts: string[] = [];

    if (this.pipeline.running_builds_count > 0) {
      parts.push(`${this.pipeline.running_builds_count} running`);
    }

    if (this.pipeline.scheduled_builds_count > 0) {
      parts.push(`${this.pipeline.scheduled_builds_count} scheduled`);
    }

    return parts.join(", ");
  }

  private getTooltip(): string {
    let tooltip = `Pipeline: ${this.pipeline.name}`;

    if (this.pipeline.description) {
      tooltip += `\n${this.pipeline.description}`;
    }

    tooltip += `\n\nDefault branch: ${this.pipeline.default_branch}`;

    if (
      this.pipeline.running_builds_count > 0 ||
      this.pipeline.scheduled_builds_count > 0
    ) {
      tooltip += `\n\nRunning builds: ${this.pipeline.running_builds_count}`;
      tooltip += `\nScheduled builds: ${this.pipeline.scheduled_builds_count}`;
    }

    return tooltip;
  }
}

import * as vscode from "vscode";
import { Job, JobState, canRetryJob } from "../../api/types";
import { getIconForJob } from "../icons";

export class JobNode extends vscode.TreeItem {
  constructor(
    public readonly job: Job,
    public readonly buildNumber: number,
    public readonly pipelineSlug: string,
    public readonly orgSlug: string,
  ) {
    super(JobNode.getLabel(job), vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon(getIconForJob(job.state));
    this.tooltip = this.getTooltip();
    // Set context value to match menu conditions in package.json
    this.contextValue = canRetryJob(job) ? "job.retriable" : "job";
  }

  private static getLabel(job: Job): string {
    return job.name || job.step_key || job.type || "Unknown Job";
  }

  private getTooltip(): string {
    const lines = [
      `Job: ${this.job.name || this.job.step_key || this.job.type || "Unknown Job"}`,
      `State: ${this.job.state}`,
    ];

    if (this.job.command) {
      const commandPreview = this.job.command.length > 100
        ? `${this.job.command.substring(0, 100)}...`
        : this.job.command;
      lines.push(`Command: ${commandPreview}`);
    }

    if (this.job.exit_status !== null) {
      lines.push(`Exit Status: ${this.job.exit_status}`);
    }

    if (this.job.started_at) {
      lines.push(`Started: ${new Date(this.job.started_at).toLocaleString()}`);
    }

    if (this.job.finished_at) {
      lines.push(
        `Finished: ${new Date(this.job.finished_at).toLocaleString()}`,
      );
    }

    return lines.join("\n");
  } 
}

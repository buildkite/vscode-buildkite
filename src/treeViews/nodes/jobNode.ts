import * as vscode from "vscode";
import { Job, JobState, canRetryJob } from "../../api/types";
import { getIconForJob } from "../icons";

/**
 * Checks if a job can be unblocked
 */
function canUnblockJob(job: Job): boolean {
  return (
    job.type === "manual" &&
    job.unblockable === true &&
    !job.unblocked_at
  );
}

export class JobNode extends vscode.TreeItem {
  constructor(
    public readonly job: Job,
    public readonly buildNumber: number,
    public readonly pipelineSlug: string,
    public readonly orgSlug: string,
  ) {
    super(JobNode.getLabel(job), vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon(this.getIcon());
    this.tooltip = this.getTooltip();
    // Set context value based on job capabilities
    this.contextValue = this.getContextValue();

    // Set click command for unblockable jobs
    if (canUnblockJob(job)) {
      this.command = {
        command: "buildkite.job.unblock",
        title: "Unblock Job",
        arguments: [this],
      };
    }
  }

  private getIcon(): string {
    // Show pass icon for unblocked jobs
    if (this.job.unblocked_at) {
      return "pass";
    }

    // Show lock icon for blocked manual jobs (block steps)
    if (this.job.state === "blocked" && this.job.type === "manual") {
      return "lock";
    }

    // Use standard state-based icon for all other jobs
    return getIconForJob(this.job.state);
  }

  private getContextValue(): string {
    const isRetriable = canRetryJob(this.job);
    const isUnblockable = canUnblockJob(this.job);

    if (isRetriable && isUnblockable) {
      return "job.retriable.unblockable";
    } else if (isRetriable) {
      return "job.retriable";
    } else if (isUnblockable) {
      return "job.unblockable";
    }
    return "job";
  }

  private static getLabel(job: Job): string {
    return job.name || job.label || job.step_key || job.type || "Unknown Job";
  }

  private getTooltip(): string {
    const lines = [
      `Job: ${this.job.name || this.job.label || this.job.step_key || this.job.type || "Unknown Job"}`,
      `State: ${this.job.state}`,
    ];

    if (this.job.command) {
      const commandPreview = this.job.command.length > 100
        ? `${this.job.command.substring(0, 100)}...`
        : this.job.command;
      lines.push(`Command: ${commandPreview}`);
    }

    // Only show exit status for non-manual jobs (block steps don't have exit status)
    if (this.job.exit_status !== null && this.job.type !== "manual") {
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

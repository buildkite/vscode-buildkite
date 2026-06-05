import * as vscode from "vscode";
import { Job, canRetryJob, canUnblockJob, getJobDisplayName } from "../../api/types";
import { getIconForJob } from "../icons";
import { JobLogContext } from "../../commands/viewJobLog";

export class JobNode extends vscode.TreeItem implements JobLogContext {
  constructor(
    public readonly job: Job,
    public readonly buildNumber: number,
    public readonly pipelineSlug: string,
    public readonly orgSlug: string,
    public readonly pipelineUuid: string,
    public readonly buildUuid: string,
  ) {
    super(JobNode.getLabel(job), vscode.TreeItemCollapsibleState.Collapsed);

    this.iconPath = new vscode.ThemeIcon(this.getIcon());
    this.tooltip = this.getTooltip();
    this.contextValue = this.getContextValue();

    if (canUnblockJob(job)) {
      this.command = {
        command: "buildkite.job.unblock",
        title: "Unblock Job",
        arguments: [this],
      };
    }
  }

  private getIcon(): string {
    if (this.job.unblocked_at) {
      return "pass";
    }

    if (this.job.state === "blocked" && this.job.type === "manual") {
      return "stop-circle";
    }

    return getIconForJob(this.job.state);
  }

  private getContextValue(): string {
    // Retriable (script) and unblockable (manual block step) are mutually
    // exclusive job types on the backend, so a job matches at most one.
    if (canRetryJob(this.job)) {
      return "job.retriable";
    }
    if (canUnblockJob(this.job)) {
      return "job.unblockable";
    }
    return "job";
  }

  private static getLabel(job: Job): string {
    return getJobDisplayName(job);
  }

  private getTooltip(): string {
    const lines = [
      `Job: ${getJobDisplayName(this.job)}`,
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

    if (this.job.unblocked_by) {
      lines.push(
        `Unblocked by: ${this.job.unblocked_by.name || "Unknown"}`,
      );
    }

    if (this.job.unblocked_at) {
      lines.push(
        `Unblocked at: ${new Date(this.job.unblocked_at).toLocaleString()}`,
      );
    }

    return lines.join("\n");
  }
}

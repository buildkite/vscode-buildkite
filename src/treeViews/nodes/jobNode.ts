import * as vscode from "vscode";
import { Job } from "../../api/types";

export class JobNode extends vscode.TreeItem {
  constructor(
    public readonly job: Job,
    public readonly orgSlug: string,
    public readonly pipelineSlug: string,
    public readonly buildNumber: number,
  ) {
    super(JobNode.getLabel(job), vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon(getIconForJob(job));
    this.tooltip = this.getTooltip();
    this.contextValue = `job-${job.state}`;
    this.description = job.state;

    // Make job clickable to view logs
    this.command = {
      command: "buildkite.job.viewLog",
      title: "View Job Log",
      arguments: [this],
    };
  }

  private static getLabel(job: Job): string {
    // Use job name if available, otherwise use step_key or type
    return job.name || job.step_key || job.type;
  }

  private getTooltip(): string {
    const lines = [
      `Job: ${JobNode.getLabel(this.job)}`,
      `State: ${this.job.state}`,
      `Type: ${this.job.type}`,
    ];

    if (this.job.command) {
      lines.push(`Command: ${this.job.command}`);
    }

    if (this.job.agent) {
      lines.push(`Agent: ${this.job.agent.name}`);
    }

    if (this.job.started_at) {
      lines.push(`Started: ${new Date(this.job.started_at).toLocaleString()}`);
    }

    if (this.job.finished_at) {
      lines.push(`Finished: ${new Date(this.job.finished_at).toLocaleString()}`);
    }

    if (this.job.exit_status !== null) {
      lines.push(`Exit Status: ${this.job.exit_status}`);
    }

    return lines.join("\n");
  }
}

/**
 * Maps job states to VS Code theme icons
 */
function getIconForJob(job: Job): string {
  // Special handling for soft failures
  if (job.soft_failed) {
    return "warning";
  }

  switch (job.state) {
    case "passed":
      return "pass";
    case "failed":
      return "error";
    case "running":
      return "sync~spin";
    case "pending":
    case "waiting":
    case "scheduled":
    case "assigned":
      return "clock";
    case "blocked":
    case "blocked_failed":
      return "debug-pause";
    case "canceling":
    case "canceled":
      return "circle-slash";
    case "skipped":
      return "debug-step-over";
    case "timed_out":
    case "timing_out":
      return "watch";
    case "broken":
    case "expired":
      return "x";
    default:
      return "circle-outline";
  }
}
import * as vscode from "vscode";
import { JobNode } from "../treeViews/nodes/jobNode";
import { BuildkiteClient } from "../api/client";
import { Logger } from "../job/jobLogOutput";

// Singleton output channel for job logs (separate from extension logs)
let jobLogOutputChannel: vscode.OutputChannel | undefined;

function getJobLogOutputChannel(): vscode.OutputChannel {
  if (!jobLogOutputChannel) {
    jobLogOutputChannel = vscode.window.createOutputChannel("Buildkite Job Logs");
  }
  return jobLogOutputChannel;
}

/**
 * Views the log output for a specific job in the Output panel.
 * @param jobNode - The job node from the tree view
 */
export async function viewJobLog(jobNode: JobNode): Promise<void> {
  const logger = Logger.getInstance();
  const client = new BuildkiteClient();
  const jobLogChannel = getJobLogOutputChannel();

  try {
    const jobName = jobNode.job.name || jobNode.job.step_key || jobNode.job.type;
    logger.info(`Fetching log for job: ${jobName}`);

    // Show loading message in job log channel
    jobLogChannel.clear();
    jobLogChannel.show();
    jobLogChannel.appendLine("=".repeat(80));
    jobLogChannel.appendLine(`Job: ${jobName}`);
    jobLogChannel.appendLine(`State: ${jobNode.job.state}`);
    jobLogChannel.appendLine(`Build #${jobNode.buildNumber}`);
    jobLogChannel.appendLine("=".repeat(80));
    jobLogChannel.appendLine("");
    jobLogChannel.appendLine("⏳ Fetching job log...");
    jobLogChannel.appendLine("");

    // Fetch the job log
    const logContent = await client.getJobLog(jobNode.job);

    // Clear and display the actual log
    jobLogChannel.clear();

    // Display header
    jobLogChannel.appendLine("=".repeat(80));
    jobLogChannel.appendLine(`Job: ${jobName}`);
    jobLogChannel.appendLine(`State: ${jobNode.job.state}`);
    jobLogChannel.appendLine(`Build #${jobNode.buildNumber}`);
    if (jobNode.job.exit_status !== null) {
      jobLogChannel.appendLine(`Exit Status: ${jobNode.job.exit_status}`);
    }
    if (jobNode.job.agent) {
      jobLogChannel.appendLine(`Agent: ${jobNode.job.agent.name}`);
    }
    if (jobNode.job.started_at) {
      jobLogChannel.appendLine(`Started: ${new Date(jobNode.job.started_at).toLocaleString()}`);
    }
    if (jobNode.job.finished_at) {
      jobLogChannel.appendLine(`Finished: ${new Date(jobNode.job.finished_at).toLocaleString()}`);
    }
    jobLogChannel.appendLine("=".repeat(80));
    jobLogChannel.appendLine("");

    // Display the log content
    if (logContent && logContent.trim().length > 0) {
      jobLogChannel.append(logContent);
      logger.info(`Successfully displayed log for job: ${jobName}`);
    } else {
      jobLogChannel.appendLine("⚠️  No log content available for this job.");
      logger.warn(`No log content available for job: ${jobName}`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to fetch job log", error as Error);

    jobLogChannel.clear();
    jobLogChannel.appendLine("❌ Failed to fetch job log");
    jobLogChannel.appendLine("");
    jobLogChannel.appendLine(`Error: ${errorMessage}`);
    jobLogChannel.show();

    vscode.window.showErrorMessage(`Failed to fetch job log: ${errorMessage}`);
  }
}

/**
 * Disposes the job log output channel
 */
export function disposeJobLogChannel(): void {
  if (jobLogOutputChannel) {
    jobLogOutputChannel.dispose();
    jobLogOutputChannel = undefined;
  }
}
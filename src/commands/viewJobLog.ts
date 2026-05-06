import * as vscode from "vscode";
import { JobNode } from "../treeViews/nodes/jobNode";
import { BuildkiteClient } from "../api/client";
import { Logger } from "../job/jobLogOutput";
import { JobLogWebview } from "../job/jobLogWebview";

// Singleton webview instance for job logs
let jobLogWebview: JobLogWebview | undefined;

function getJobLogWebview(): JobLogWebview {
  if (!jobLogWebview) {
    jobLogWebview = new JobLogWebview();
  }
  return jobLogWebview;
}

/**
 * Views the log output for a specific job in a webview with ANSI color support.
 * @param jobNode - The job node from the tree view
 */
export async function viewJobLog(client: BuildkiteClient, jobNode: JobNode): Promise<void> {
  const logger = Logger.getInstance();

  try {
    const jobName = jobNode.job.name || jobNode.job.id || jobNode.job.step_key || "Unknown Job";
    const jobId = jobNode.job.id || "Unknown Job ID";
    logger.debug(`viewJobLog called for job: ${jobName} (id: ${jobId}, state: ${jobNode.job.state}, type: ${jobNode.job.type}, hasRawLogUrl: ${!!jobNode.job.raw_log_url})`);
    logger.info(`Fetching log for job: ${jobName}`);


    // Show a progress notification while fetching
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching log for ${jobName}...`,
        cancellable: false,
      },
      async () => {
        // Fetch the job log
        const logContent = await client.getJobLog(jobNode.job);

        // Display the log content in webview
        if (logContent && logContent.trim().length > 0) {
          const webview = getJobLogWebview();
          const jobDetails = `${jobNode.pipelineSlug} > ${jobNode.buildNumber} > Log for ${jobName}`;
          webview.show(jobId, jobName, jobDetails, logContent);
          logger.debug(`Successfully displayed log for job: ${jobName}`);
        } else {
          vscode.window.showWarningMessage("No log content available for this job.");
          logger.warn(`No log content available for job: ${jobName}`);
        }
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to fetch job log", error as Error);
    vscode.window.showErrorMessage(`Failed to fetch job log: ${errorMessage}`);
  }
}

/**
 * Disposes the job log webview
 */
export function disposeJobLogWebview(): void {
  if (jobLogWebview) {
    jobLogWebview.dispose();
    jobLogWebview = undefined;
  }
}
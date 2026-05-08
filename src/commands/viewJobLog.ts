import * as vscode from "vscode";
import { JobNode } from "../treeViews/nodes/jobNode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { debug, error, info, redactIfCredentialShaped, warn } from "../log";
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
export async function viewJobLog(client: CachedApiClient, jobNode: JobNode): Promise<void> {
  try {
    const jobName = jobNode.job.name || jobNode.job.id || jobNode.job.step_key || "Unknown Job";
    const jobId = jobNode.job.id || "Unknown Job ID";
    debug(`[Job] viewJobLog called for job: ${jobName} (id: ${jobId}, state: ${jobNode.job.state}, type: ${jobNode.job.type}, hasRawLogUrl: ${!!jobNode.job.raw_log_url})`);
    info(`[Job] Fetching log for job: ${jobName}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching log for ${jobName}...`,
        cancellable: false,
      },
      async () => {
        const logContent = await client.getJobLog(jobNode.job);

        if (logContent && logContent.trim().length > 0) {
          const webview = getJobLogWebview();
          const jobDetails = `${jobNode.pipelineSlug} > ${jobNode.buildNumber} > Log for ${jobName}`;
          webview.show(jobId, jobName, jobDetails, logContent);
          debug(`[Job] Successfully displayed log for job: ${jobName}`);
        } else {
          vscode.window.showWarningMessage("No log content available for this job.");
          warn(`[Job] No log content available for job: ${jobName}`);
        }
      }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
    error(`[Job] Failed to fetch job log: ${redactIfCredentialShaped(errorMessage + stack)}`);
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
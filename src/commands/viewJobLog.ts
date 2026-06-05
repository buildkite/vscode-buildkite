import * as vscode from "vscode";
import { Job } from "../api/types";
import { CachedApiClient } from "../cache/cachedApiClient";
import { debug, error, info, redactIfCredentialShaped, warn } from "../log";
import { JobLogWebview } from "../job/jobLogWebview";
import { track } from "../analytics/analytics";

// Singleton webview instance for job logs
let jobLogWebview: JobLogWebview | undefined;

function getJobLogWebview(): JobLogWebview {
  if (!jobLogWebview) {
    jobLogWebview = new JobLogWebview();
  }
  return jobLogWebview;
}

/**
 * Interface for job log context - can be from tree view or programmatic
 */
export interface JobLogContext {
  job: Job;
  pipelineSlug: string;
  buildNumber: number;
  orgSlug?: string;
  pipelineUuid: string;
  buildUuid: string;
}

/**
 * Views the log output for a specific job in a webview with ANSI color support.
 * @param context - The job context containing job data and build info
 */
export async function viewJobLog(client: CachedApiClient, context: JobLogContext): Promise<void> {
  try {
    const jobName = context.job.name || context.job.id || context.job.step_key || "Unknown Job";
    const jobId = context.job.id || "Unknown Job ID";
    debug(`[Job] viewJobLog called for job: ${jobName} (id: ${jobId}, state: ${context.job.state}, type: ${context.job.type}, hasRawLogUrl: ${!!context.job.raw_log_url})`);
    info(`[Job] Fetching log for job: ${jobName}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching log for ${jobName}...`,
        cancellable: false,
      },
      async () => {
        const logContent = await client.getJobLog(context.job);

        if (logContent && logContent.trim().length > 0) {
          track("job log", { target: "editor", pipeline_uuid: context.pipelineUuid, build_uuid: context.buildUuid, job_uuid: context.job.id });
          const webview = getJobLogWebview();
          const jobDetails = `${context.pipelineSlug} > ${context.buildNumber} > Log for ${jobName}`;
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
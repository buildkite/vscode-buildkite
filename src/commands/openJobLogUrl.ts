import * as vscode from "vscode";
import { JobNode } from "../treeViews/nodes/jobNode";
import { Logger } from "../job/jobLogOutput";

export async function openJobLogUrl(node: JobNode): Promise<void> {
  if (!node || !(node instanceof JobNode)) {
    vscode.window.showErrorMessage("Invalid job node");
    return;
  }

  try {
    const logger = Logger.getInstance();

    // Construct the web-friendly job log URL
    // Format: https://buildkite.com/organizations/{org-slug}/pipelines/{pipeline-slug}/builds/{build-number}/jobs/{job-id}/log
    const logUrl = `https://buildkite.com/organizations/${node.orgSlug}/pipelines/${node.pipelineSlug}/builds/${node.buildNumber}/jobs/${node.job.id}/log`;

    logger.info(`Opening job log in external browser: ${logUrl}`);
    const uri = vscode.Uri.parse(logUrl);
    await vscode.env.openExternal(uri);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to open job log: ${errorMessage}`);
  }
}
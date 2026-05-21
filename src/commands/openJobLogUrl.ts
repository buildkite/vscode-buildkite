import * as vscode from "vscode";
import { JobNode } from "../treeViews/nodes/jobNode";
import { info } from "../log";

export async function openJobLogUrl(node: JobNode): Promise<void> {
  if (!node || !(node instanceof JobNode)) {
    vscode.window.showErrorMessage("Invalid job node");
    return;
  }

  try {
    // Format: https://buildkite.com/organizations/{org-slug}/pipelines/{pipeline-slug}/builds/{build-number}/jobs/{job-id}/log
    const logUrl = `https://buildkite.com/organizations/${node.orgSlug}/pipelines/${node.pipelineSlug}/builds/${node.buildNumber}/jobs/${node.job.id}/log`;

    info(`[Job] Opening job log in external browser: ${logUrl}`);
    const uri = vscode.Uri.parse(logUrl);
    await vscode.env.openExternal(uri);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to open job log: ${errorMessage}`);
  }
}
import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { JobNode } from "../treeViews/nodes/jobNode";
import { canRetryJob, getJobDisplayName } from "../api/types";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function retryJob(client: BuildkiteClient, node: JobNode): Promise<void> {
  if (!node || !(node instanceof JobNode)) {
    vscode.window.showErrorMessage("Invalid job node");
    return;
  }

  if (!canRetryJob(node.job)) {
    vscode.window.showWarningMessage(
      `Cannot retry job: Only failed, timed_out, or jobs with permit_on_passed can be retried.`,
    );
    return;
  }

  const jobLabel = getJobDisplayName(node.job);
  const confirmation = await vscode.window.showWarningMessage(
    `Retry job "${jobLabel}" in build #${node.buildNumber}?`,
    { modal: true },
    "Retry",
  );

  if (confirmation !== "Retry") {
    return;
  }

  try {
    await client.retryJob(
      node.orgSlug,
      node.pipelineSlug,
      node.buildNumber,
      node.job.id,
    );

    vscode.window.showInformationMessage(
      `Job "${jobLabel}" has been queued for retry`,
    );

    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to retry job: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to retry job: An unknown error occurred",
      );
    }
  }
}

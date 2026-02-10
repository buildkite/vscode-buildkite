import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { canUnblockJob, getJobDisplayName } from "../api/types";
import { JobNode } from "../treeViews/nodes/jobNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";
import { buildConfirmationMessage, collectFieldValues, normalizeFieldValues } from "./blockStepHelpers";

export async function unblockJob(node: JobNode): Promise<void> {
  if (!node || !(node instanceof JobNode)) {
    vscode.window.showErrorMessage("Invalid job node");
    return;
  }

  if (!canUnblockJob(node.job)) {
    vscode.window.showWarningMessage(
      `Cannot unblock job: Job must be a manual block step that hasn't been unblocked yet.`,
    );
    return;
  }

  const jobName = getJobDisplayName(node.job);

  try {
    let fieldValues: Record<string, string | string[]> | undefined;
    if (node.job.fields && node.job.fields.length > 0) {
      fieldValues = await collectFieldValues(node.job.fields);
      if (!fieldValues) {
        return;
      }
    }

    const confirmation = await vscode.window.showWarningMessage(
      buildConfirmationMessage(
        `Job "${jobName}" in build #${node.buildNumber} is waiting on approval.`,
        fieldValues,
      ),
      { modal: true },
      "Unblock",
    );

    if (confirmation !== "Unblock") {
      return;
    }

    const client = new BuildkiteClient();

    const normalizedFields = normalizeFieldValues(fieldValues);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Unblocking "${jobName}"...`,
        cancellable: false,
      },
      async () => {
        await client.unblockJob(
          node.orgSlug,
          node.pipelineSlug,
          node.buildNumber,
          node.job.id,
          normalizedFields,
        );
      },
    );

    vscode.window.showInformationMessage(
      `Job "${jobName}" has been unblocked`,
    );

    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to unblock job: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to unblock job: An unknown error occurred",
      );
    }
  }
}

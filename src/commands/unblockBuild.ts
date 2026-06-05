import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { canUnblockJob, getJobDisplayName } from "../api/types";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";
import { buildConfirmationMessage, collectFieldValues, normalizeFieldValues } from "./blockStepHelpers";
import { track } from "../analytics/analytics";

export async function unblockBuild(client: CachedApiClient, node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  if (!node.build.blocked) {
    vscode.window.showWarningMessage(
      `Build #${node.build.number} is not blocked`,
    );
    return;
  }

  try {

    const jobs = await client.getJobs(
      node.orgSlug,
      node.pipeline.slug,
      node.build.number,
    );

    const unblockableJob = jobs.find(canUnblockJob);

    if (!unblockableJob) {
      vscode.window.showWarningMessage(
        `No unblockable jobs found in build #${node.build.number}`,
      );
      return;
    }

    const jobName = getJobDisplayName(unblockableJob);

    let fieldValues: Record<string, string | string[]> | undefined;
    if (unblockableJob.fields && unblockableJob.fields.length > 0) {
      fieldValues = await collectFieldValues(unblockableJob.fields);
      if (!fieldValues) {
        return;
      }
    }

    const confirmation = await vscode.window.showWarningMessage(
      buildConfirmationMessage(
        `Unblock "${jobName}" in build #${node.build.number}?`,
        fieldValues,
      ),
      { modal: true },
      "Unblock",
    );

    if (confirmation !== "Unblock") {
      return;
    }

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
          node.pipeline.slug,
          node.build.number,
          unblockableJob.id,
          normalizedFields,
        );
      },
    );

    track("build unblock", { pipeline_uuid: node.pipeline.id, build_uuid: node.build.id });

    vscode.window.showInformationMessage(
      `Job "${jobName}" has been unblocked`,
    );

    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to unblock build: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to unblock build: An unknown error occurred",
      );
    }
  }
}

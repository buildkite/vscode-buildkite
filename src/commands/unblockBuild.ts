import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { Job } from "../api/types";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function unblockBuild(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  // Check if build is blocked
  if (!node.build.blocked) {
    vscode.window.showInformationMessage(
      `Build #${node.build.number} is not blocked`,
    );
    return;
  }

  try {
    // Fetch build with jobs
    const build = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching jobs for build #${node.build.number}...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        return client.getBuild(
          node.orgSlug,
          node.pipeline.slug,
          node.build.number,
        );
      },
    );

    const jobs = build.jobs || [];

    // Filter for unblockable jobs
    // Block steps are typically type "manual" and could be in various states
    const unblockableJobs = jobs.filter(
      (job: Job) =>
        job.type === "manual" &&
        (job.state === "blocked" || job.state === "waiting"),
    );

    if (unblockableJobs.length === 0) {
      vscode.window.showErrorMessage(
        `No unblockable jobs found in build #${node.build.number}`,
      );
      return;
    }

    // If multiple blocked jobs, show QuickPick for selection
    let selectedJob: Job;
    if (unblockableJobs.length > 1) {
      const selected = await vscode.window.showQuickPick(
        unblockableJobs.map((job: Job) => ({
          label: job.name || job.label || "Unnamed job",
          description: `State: ${job.state}`,
          job,
        })),
        {
          placeHolder: "Select a job to unblock",
          ignoreFocusOut: true,
        },
      );

      if (!selected) {
        return;
      }
      selectedJob = selected.job;
    } else {
      selectedJob = unblockableJobs[0];
    }

    // Show confirmation dialog
    const jobName = selectedJob.name || selectedJob.label || "Unnamed job";
    const confirmation = await vscode.window.showWarningMessage(
      `Build #${node.build.number} is waiting on approval for the ${jobName} step.`,
      { modal: true },
      "Unblock",
    );

    if (confirmation !== "Unblock") {
      return;
    }

    // Execute unblock with progress indicator
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Unblocking job '${jobName}'...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        await client.unblockJob(
          node.orgSlug,
          node.pipeline.slug,
          node.build.number,
          selectedJob.id,
        );
      },
    );

    vscode.window.showInformationMessage(
      `Job '${jobName}' in build #${node.build.number} has been unblocked`,
    );

    // Refresh the tree to show the updated build state
    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to unblock: ${error.message}`);
    }
  }
}

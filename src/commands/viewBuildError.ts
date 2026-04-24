import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { Build, Pipeline } from "../api/types";

interface ViewBuildErrorArgs {
  build: Build;
  pipeline: Pipeline;
  orgSlug: string;
}

/**
 * View build errors by opening the job logs of failed jobs.
 * If multiple jobs failed, shows a quick pick to select which job's logs to view.
 */
export async function viewBuildError(args: ViewBuildErrorArgs): Promise<void> {
  const { build, pipeline, orgSlug } = args;

  if (!build.jobs || build.jobs.length === 0) {
    // Fetch jobs if not already loaded
    const client = new BuildkiteClient();
    try {
      const jobs = await client.getJobs(orgSlug, pipeline.slug, build.number);
      build.jobs = jobs;
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to fetch build details: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return;
    }
  }

  // Find failed jobs (excluding soft failures)
  const failedJobs =
    build.jobs?.filter(
      (job) =>
        job.state === "failed" &&
        !job.soft_failed &&
        job.exit_status !== null,
    ) || [];

  if (failedJobs.length === 0) {
    vscode.window.showInformationMessage(
      "No failed jobs found in this build. The failure may have been in a different stage or job.",
    );

    // Open the build in Buildkite for more details
    const action = await vscode.window.showInformationMessage(
      "Would you like to view the build in Buildkite?",
      "Open in Buildkite",
    );

    if (action === "Open in Buildkite") {
      await vscode.env.openExternal(vscode.Uri.parse(build.web_url));
    }
    return;
  }

  // If there's only one failed job, view its log directly
  if (failedJobs.length === 1) {
    const job = failedJobs[0];
    await vscode.commands.executeCommand("buildkite.job.viewJobLog", {
      job,
      buildNumber: build.number,
      pipelineSlug: pipeline.slug,
      orgSlug,
    });
    return;
  }

  // Multiple failed jobs - show quick pick
  const selected = await vscode.window.showQuickPick(
    failedJobs.map((job) => ({
      label: job.name || job.label || job.step_key || "Unnamed job",
      description: `Exit code: ${job.exit_status}`,
      detail: job.command
        ? job.command.length > 80
          ? job.command.substring(0, 80) + "..."
          : job.command
        : undefined,
      job,
    })),
    {
      placeHolder: `Select a failed job from ${pipeline.name} #${build.number} to view logs`,
    },
  );

  if (selected) {
    await vscode.commands.executeCommand("buildkite.job.viewJobLog", {
      job: selected.job,
      buildNumber: build.number,
      pipelineSlug: pipeline.slug,
      orgSlug,
    });
  }
}

import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { Build, Pipeline } from "../api/types";
import { track } from "../analytics/analytics";

interface ViewBuildErrorArgs {
  build: Build;
  pipeline: Pipeline;
  orgSlug: string;
}

/**
 * View build errors by opening the job logs of failed jobs.
 * If multiple jobs failed, shows a quick pick to select which job's logs to view.
 */
export async function viewBuildError(client: CachedApiClient, args: ViewBuildErrorArgs): Promise<void> {
  const { build, pipeline, orgSlug } = args;
  track("build view error", { pipeline_uuid: pipeline.id, build_uuid: build.id });

  // Use existing jobs from the build, or fetch them fresh
  let jobs = build.jobs;
  if (!jobs || jobs.length === 0) {
    try {
      jobs = await client.getJobs(orgSlug, pipeline.slug, build.number);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to fetch build details: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return;
    }
  }

  // Find failed jobs (excluding soft failures)
  const failedJobs =
    jobs?.filter(
      (job) =>
        job.state === "failed" &&
        !job.soft_failed &&
        job.exit_status !== null,
    ) || [];

  if (failedJobs.length === 0) {
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
      pipelineUuid: pipeline.id,
      buildUuid: build.id,
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
      pipelineUuid: pipeline.id,
      buildUuid: build.id,
    });
  }
}

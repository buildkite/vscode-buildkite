import * as vscode from "vscode";
import { Pipeline, Build } from "../api/types";
import { BuildkiteClient } from "../api/client";
import { getIconForBuild } from "../treeViews/icons";

interface PipelineQuickPickItem extends vscode.QuickPickItem {
  pipeline: Pipeline;
  build?: Build;
}

interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: "view" | "open" | "rebuild";
}

export async function showPipelineQuickPick(
  matchedPipelines: Pipeline[],
  latestBuilds: Map<string, Build>,
  orgSlug: string,
  client: BuildkiteClient,
): Promise<void> {
  // Single pipeline - go directly to actions
  if (matchedPipelines.length === 1) {
    const pipeline = matchedPipelines[0];
    const build = latestBuilds.get(pipeline.slug);
    await showActionsQuickPick(pipeline, build, orgSlug, client);
    return;
  }

  // Multiple pipelines - show pipeline picker first
  const items: PipelineQuickPickItem[] = matchedPipelines.map((pipeline) => {
    const build = latestBuilds.get(pipeline.slug);
    const icon = build ? getIconForBuild(build.state) : "circle-outline";
    const description = build
      ? `#${build.number} ${build.state}`
      : "No builds";

    return {
      label: `$(${icon}) ${pipeline.name}`,
      description,
      detail: build?.branch ? `Branch: ${build.branch}` : undefined,
      pipeline,
      build,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a pipeline",
    title: "Buildkite Pipelines",
  });

  if (selected) {
    await showActionsQuickPick(
      selected.pipeline,
      selected.build,
      orgSlug,
      client,
    );
  }
}

async function showActionsQuickPick(
  pipeline: Pipeline,
  build: Build | undefined,
  orgSlug: string,
  client: BuildkiteClient,
): Promise<void> {
  const actions: ActionQuickPickItem[] = [];

  if (build) {
    actions.push({
      label: "$(globe) Open in Browser",
      description: `View build #${build.number} on Buildkite`,
      action: "open",
    });

    actions.push({
      label: "$(debug-restart) Rebuild",
      description: `Rebuild #${build.number}`,
      action: "rebuild",
    });
  }

  actions.push({
    label: "$(link-external) Open Pipeline",
    description: "Open pipeline page on Buildkite",
    action: "view",
  });

  const selected = await vscode.window.showQuickPick(actions, {
    placeHolder: `Actions for ${pipeline.name}`,
    title: build ? `Build #${build.number} - ${build.state}` : pipeline.name,
  });

  if (!selected) {
    return;
  }

  switch (selected.action) {
    case "open":
      if (build) {
        await vscode.env.openExternal(vscode.Uri.parse(build.web_url));
      }
      break;

    case "view":
      await vscode.env.openExternal(vscode.Uri.parse(pipeline.web_url));
      break;

    case "rebuild":
      if (build) {
        await rebuildBuildFromStatusBar(pipeline, build, orgSlug, client);
      }
      break;
  }
}

async function rebuildBuildFromStatusBar(
  pipeline: Pipeline,
  build: Build,
  orgSlug: string,
  client: BuildkiteClient,
): Promise<void> {
  const confirm = await vscode.window.showQuickPick(
    [
      { label: "Yes", description: `Rebuild #${build.number}` },
      { label: "No", description: "Cancel" },
    ],
    { placeHolder: `Rebuild #${build.number} for ${pipeline.name}?` },
  );

  if (confirm?.label !== "Yes") {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Rebuilding #${build.number}...`,
        cancellable: false,
      },
      async () => {
        await client.rebuildBuild(orgSlug, pipeline.slug, build.number);
      },
    );

    vscode.window.showInformationMessage(
      `Build #${build.number} has been restarted.`,
    );

    // Refresh the status bar
    vscode.commands.executeCommand("buildkite.statusBar.refresh");
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to rebuild: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

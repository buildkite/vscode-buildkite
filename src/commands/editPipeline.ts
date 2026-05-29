import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { PipelineNode } from "../treeViews/nodes/pipelineNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function editPipeline(client: CachedApiClient, node: PipelineNode): Promise<void> {
  if (!node || !(node instanceof PipelineNode)) {
    vscode.window.showErrorMessage("Invalid pipeline node");
    return;
  }

  const { pipeline, orgSlug } = node;

  const name = await vscode.window.showInputBox({
    prompt: "Pipeline name",
    value: pipeline.name,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : "Pipeline name is required"),
  });
  if (name === undefined) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: "Description (optional)",
    value: pipeline.description ?? "",
    ignoreFocusOut: true,
  });
  if (description === undefined) {
    return;
  }

  const defaultBranch = await vscode.window.showInputBox({
    prompt: "Default branch",
    value: pipeline.default_branch,
    ignoreFocusOut: true,
  });
  if (defaultBranch === undefined) {
    return;
  }

  const repository = await vscode.window.showInputBox({
    prompt: "Repository URL",
    value: pipeline.repository,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : "Repository URL is required"),
  });
  if (repository === undefined) {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Updating pipeline "${pipeline.name}"...`,
        cancellable: false,
      },
      async () => {
        const trimmedDescription = description.trim();
        await client.updatePipeline(orgSlug, pipeline.slug, {
          name: name.trim(),
          // Only send description if it changed; omitting it avoids accidentally
          // clearing a description the user left blank in the input box.
          ...(trimmedDescription !== (pipeline.description ?? "") && { description: trimmedDescription }),
          default_branch: defaultBranch.trim(),
          repository: repository.trim(),
        });
      },
    );

    vscode.window.showInformationMessage(`Pipeline "${name}" updated successfully.`);
    await getPipelinesTreeProvider().refresh();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to update pipeline: ${errorMessage}`);
  }
}

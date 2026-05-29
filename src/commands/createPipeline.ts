import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function createPipeline(client: CachedApiClient): Promise<void> {
  let org;
  try {
    org = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Fetching organization...",
        cancellable: false,
      },
      () => client.getOrganization(),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to get organization: ${errorMessage}`);
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Pipeline name",
    placeHolder: "e.g. my-pipeline",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : "Pipeline name is required"),
  });
  if (!name) {
    return;
  }

  const repository = await vscode.window.showInputBox({
    prompt: "Repository URL",
    placeHolder: "e.g. https://github.com/my-org/my-repo",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : "Repository URL is required"),
  });
  if (!repository) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: "Description (optional)",
    placeHolder: "A short description of this pipeline",
    ignoreFocusOut: true,
  });

  const defaultBranch = await vscode.window.showInputBox({
    prompt: "Default branch (optional)",
    placeHolder: "main",
    ignoreFocusOut: true,
  });

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating pipeline "${name}"...`,
        cancellable: false,
      },
      async () => {
        await client.createPipeline(org.slug, {
          name: name.trim(),
          repository: repository.trim(),
          ...(description?.trim() && { description: description.trim() }),
          ...(defaultBranch?.trim() && { default_branch: defaultBranch.trim() }),
        });
      },
    );

    vscode.window.showInformationMessage(`Pipeline "${name}" created successfully.`);
    await getPipelinesTreeProvider().refresh();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to create pipeline: ${errorMessage}`);
  }
}

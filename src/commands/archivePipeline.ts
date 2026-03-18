import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { PipelineNode } from "../treeViews/nodes/pipelineNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

export async function archivePipeline(node: PipelineNode): Promise<void> {
  if (!node || !(node instanceof PipelineNode)) {
    vscode.window.showErrorMessage("Invalid pipeline node");
    return;
  }

  const { pipeline, orgSlug } = node;

  const confirmation = await vscode.window.showWarningMessage(
    `Archive pipeline "${pipeline.name}"? It will no longer appear in the active pipelines list.`,
    { modal: true },
    "Archive",
  );
  if (confirmation !== "Archive") {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Archiving pipeline "${pipeline.name}"...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        await client.archivePipeline(orgSlug, pipeline.slug);
      },
    );

    vscode.window.showInformationMessage(`Pipeline "${pipeline.name}" archived.`);
    await getPipelinesTreeProvider().refresh();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to archive pipeline: ${errorMessage}`);
  }
}

export async function unarchivePipeline(node: PipelineNode): Promise<void> {
  if (!node || !(node instanceof PipelineNode)) {
    vscode.window.showErrorMessage("Invalid pipeline node");
    return;
  }

  const { pipeline, orgSlug } = node;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Unarchiving pipeline "${pipeline.name}"...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        await client.unarchivePipeline(orgSlug, pipeline.slug);
      },
    );

    vscode.window.showInformationMessage(`Pipeline "${pipeline.name}" unarchived.`);
    await getPipelinesTreeProvider().refresh();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to unarchive pipeline: ${errorMessage}`);
  }
}

export async function deletePipeline(node: PipelineNode): Promise<void> {
  if (!node || !(node instanceof PipelineNode)) {
    vscode.window.showErrorMessage("Invalid pipeline node");
    return;
  }

  const { pipeline, orgSlug } = node;

  const confirmation = await vscode.window.showWarningMessage(
    `Permanently delete pipeline "${pipeline.name}"? This cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (confirmation !== "Delete") {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Deleting pipeline "${pipeline.name}"...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        await client.deletePipeline(orgSlug, pipeline.slug);
      },
    );

    vscode.window.showInformationMessage(`Pipeline "${pipeline.name}" deleted.`);
    await getPipelinesTreeProvider().refresh();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to delete pipeline: ${errorMessage}`);
  }
}

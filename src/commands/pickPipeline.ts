import * as vscode from "vscode";
import { getPipelinesTreeProvider, getPipelinesTreeView } from "../treeViews/treeViews";
import { PipelineNode } from "../treeViews/nodes/pipelineNode";

export async function pickPipeline(): Promise<void> {
  const provider = getPipelinesTreeProvider();
  let nodes = provider.getPipelineNodes();

  // Tree hasn't loaded yet — fetch and cache via the provider so reveal() works
  if (nodes.length === 0) {
    try {
      const children = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading pipelines...",
          cancellable: false,
        },
        () => provider.getChildren(undefined),
      );
      nodes = children.filter((c): c is PipelineNode => c instanceof PipelineNode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to load pipelines: ${errorMessage}`);
      return;
    }
  }

  if (nodes.length === 0) {
    vscode.window.showInformationMessage("No pipelines found.");
    return;
  }

  type PipelineQuickPickItem = vscode.QuickPickItem & { node: PipelineNode };

  const items: PipelineQuickPickItem[] = nodes.map((node) => ({
    label: node.pipeline.name,
    description: node.description as string | undefined,
    detail: node.pipeline.description ?? undefined,
    node,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Switch Pipeline",
    placeHolder: "Type to search pipelines...",
    matchOnDescription: true,
  });

  if (!picked) {
    return;
  }

  await getPipelinesTreeView().reveal(picked.node, { focus: true, select: true, expand: true });
}

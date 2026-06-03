import * as vscode from "vscode";
import { getPipelinesTreeProvider, getPipelinesTreeView } from "../treeViews/treeViews";
import { PipelineNode } from "../treeViews/nodes/pipelineNode";
import { ErrorNode } from "../treeViews/nodes/errorNode";
import { track } from "../analytics/analytics";

export async function pickPipeline(): Promise<void> {
  const provider = getPipelinesTreeProvider();
  let nodes = provider.getPipelineNodes();

  // Tree hasn't loaded yet — fetch and cache via the provider so reveal() works
  if (nodes.length === 0) {
    let children: Awaited<ReturnType<typeof provider.getChildren>>;
    try {
      children = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading pipelines...",
          cancellable: false,
        },
        () => provider.getChildren(undefined),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to load pipelines: ${errorMessage}`);
      return;
    }

    // tree returns [] when there's no session, viewsWelcome handles the UI
    if (children.length === 0) {
      vscode.window.showErrorMessage("Buildkite: not signed in. Run 'Buildkite: Sign In' first.");
      return;
    }

    const errorNode = children.find((c) => c instanceof ErrorNode) as ErrorNode | undefined;
    if (errorNode) {
      vscode.window.showErrorMessage(`Buildkite: ${errorNode.label}`);
      return;
    }

    nodes = children.filter((c): c is PipelineNode => c instanceof PipelineNode);
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

  track("pipeline.switch_clicked", { pipeline_uuid: picked.node.pipeline.id });
  await getPipelinesTreeView().reveal(picked.node, { focus: true, select: true, expand: true });
}

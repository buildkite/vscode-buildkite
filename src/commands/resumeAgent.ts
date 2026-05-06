import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { AgentNode } from "../treeViews/nodes/agentNode";
import { getAgentsTreeProvider } from "../treeViews/treeViews";

export async function resumeAgent(client: BuildkiteClient, node: AgentNode): Promise<void> {
  if (!node || !(node instanceof AgentNode)) {
    vscode.window.showErrorMessage("Invalid agent node");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Resume agent "${node.agent.name || node.agent.hostname}"? The agent will start receiving jobs again.`,
    { modal: true },
    "Resume",
  );

  if (confirmation !== "Resume") {
    return;
  }

  try {
    await client.resumeAgent(node.orgSlug, node.agent.id);

    vscode.window.showInformationMessage(
      `Agent "${node.agent.name || node.agent.hostname}" has been resumed.`,
    );

    const treeProvider = getAgentsTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(
        `Failed to resume agent: ${error.message}`,
      );
    } else {
      vscode.window.showErrorMessage(
        "Failed to resume agent: An unknown error occurred",
      );
    }
  }
}

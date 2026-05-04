import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { AgentNode } from "../treeViews/nodes/agentNode";
import { getAgentsTreeProvider } from "../treeViews/treeViews";

export async function pauseAgent(node: AgentNode): Promise<void> {
  if (!node || !(node instanceof AgentNode)) {
    vscode.window.showErrorMessage("Invalid agent node");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Pause agent "${node.agent.name || node.agent.hostname}"? The agent will stop receiving new jobs but stay running.`,
    { modal: true },
    "Pause",
  );

  if (confirmation !== "Pause") {
    return;
  }

  try {
    const client = CachedApiClient.getInstance();
    await client.pauseAgent(node.orgSlug, node.agent.id);

    vscode.window.showInformationMessage(
      `Agent "${node.agent.name || node.agent.hostname}" has been paused.`,
    );

    const treeProvider = getAgentsTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to pause agent: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to pause agent: An unknown error occurred",
      );
    }
  }
}

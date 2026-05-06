import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { AgentNode } from "../treeViews/nodes/agentNode";
import { getAgentsTreeProvider } from "../treeViews/treeViews";
import { pollUntilAgentGone } from "./agentStopPoller";

export async function stopAgent(client: BuildkiteClient, node: AgentNode): Promise<void> {
  if (!node || !(node instanceof AgentNode)) {
    vscode.window.showErrorMessage("Invalid agent node");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Stop agent "${node.agent.name || node.agent.hostname}"? The agent will stop accepting jobs and shut down.`,
    { modal: true },
    "Stop",
  );

  if (confirmation !== "Stop") {
    return;
  }

  try {
    await client.stopAgent(node.orgSlug, node.agent.id);

    vscode.window.showInformationMessage(
      `Agent "${node.agent.name || node.agent.hostname}" has been instructed to stop.`,
    );

    const treeProvider = getAgentsTreeProvider();
    await treeProvider.refresh();
    await pollUntilAgentGone(client, node.orgSlug, node.agent.id, treeProvider);
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to stop agent: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to stop agent: An unknown error occurred",
      );
    }
  }
}

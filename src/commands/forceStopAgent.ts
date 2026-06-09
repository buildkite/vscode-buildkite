import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { AgentNode } from "../treeViews/nodes/agentNode";
import { getAgentsTreeProvider } from "../treeViews/treeViews";
import { pollUntilAgentGone } from "./agentStopPoller";
import { track } from "../analytics/analytics";

export async function forceStopAgent(client: CachedApiClient, node: AgentNode): Promise<void> {
  if (!node || !(node instanceof AgentNode)) {
    vscode.window.showErrorMessage("Invalid agent node");
    return;
  }

  const agentLabel = node.agent.name || node.agent.hostname;
  const jobLabel = node.agent.job?.name || node.agent.job?.type || "the running job";

  const confirmation = await vscode.window.showWarningMessage(
    `Force stop agent "${agentLabel}"? This will immediately kill ${jobLabel} and shut down the agent without waiting for it to finish.`,
    { modal: true },
    "Force Stop",
  );

  if (confirmation !== "Force Stop") {
    return;
  }

  try {
    await client.forceStopAgent(node.orgSlug, node.agent.id);
    track("agent stop", { force: true, agent_uuid: node.agent.id });

    vscode.window.showInformationMessage(
      `Agent "${agentLabel}" has been force stopped.`,
    );

    const treeProvider = getAgentsTreeProvider();
    await treeProvider.refresh();
    await pollUntilAgentGone(client, node.orgSlug, node.agent.id, treeProvider);
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to force stop agent: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to force stop agent: An unknown error occurred",
      );
    }
  }
}

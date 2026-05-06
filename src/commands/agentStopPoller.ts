import { BuildkiteClient } from "../api/client";
import { AgentsTreeProvider } from "../treeViews/agents";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 5;

/**
 * Polls the agents list after a stop command until the target agent is no longer
 * connected (or max attempts reached), refreshing the tree view each time.
 */
export async function pollUntilAgentGone(
  client: BuildkiteClient,
  orgSlug: string,
  agentId: string,
  treeProvider: AgentsTreeProvider,
): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const agents = await client.getAgents(orgSlug);
    const stillConnected = agents.some((a) => a.id === agentId);

    await treeProvider.refresh();

    if (!stillConnected) {
      break;
    }
  }
}

import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { AuthManager } from "../api/auth";
import { Agent } from "../api/types";
import { AgentNode } from "./nodes/agentNode";
import { ErrorNode } from "./nodes/errorNode";

type AgentsTreeNode = AgentNode | ErrorNode;

// Background refresh cadence, matched to the build poller and status bar so the
// agents view doesn't look frozen next to them (SUP-7210).
const AGENTS_POLL_INTERVAL = 60000; // 60 seconds

export class AgentsTreeProvider
  implements vscode.TreeDataProvider<AgentsTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    AgentsTreeNode | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: CachedApiClient;
  private filterQuery = "";
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly authManager: AuthManager,
    client: CachedApiClient,
  ) {
    this.client = client;
    this.startPolling();
  }

  async refresh(): Promise<void> {
    this.client.clearCache();
    this._onDidChangeTreeData.fire(null);
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(async () => {
      await this.poll();
    }, AGENTS_POLL_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // Drop only the cached agents list and re-render. Skips work while signed out
  // so we don't churn, and leaves the pipeline/build caches alone.
  private async poll(): Promise<void> {
    try {
      const session = await this.authManager.resolveSession();
      if (!session) {
        return;
      }
      const org = await this.client.getOrganization();
      this.client.clearAgentsCache(org.slug);
    } catch {
      // transient (auth / network / org lookup); try again on the next tick
      return;
    }
    this._onDidChangeTreeData.fire(null);
  }

  setFilter(query: string): void {
    this.filterQuery = query.trim();
    this._onDidChangeTreeData.fire(null);
  }

  getFilter(): string {
    return this.filterQuery;
  }

  dispose(): void {
    this.stopPolling();
    this._onDidChangeTreeData.dispose();
    // Don't dispose `this.client`, it's the shared CachedApiClient owned
    // by extension.ts and used by other components too
  }

  getTreeItem(element: AgentsTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentsTreeNode): Promise<AgentsTreeNode[]> {
    const session = await this.authManager.resolveSession();
    const token = session?.token;

    try {
      if (element) {
        return [];
      }

      if (!token) {
        // empty triggers viewsWelcome from package.json
        return [];
      }

      const org = await this.client.getOrganization();
      const agents = await this.client.getAgents(org.slug);

      if (agents.length === 0) {
        return [
          new ErrorNode(
            `No connected agents in "${org.name}". Ensure your token has the read_agents scope.`,
          ),
        ];
      }

      const filtered = this.applyFilter(agents);

      if (filtered.length === 0) {
        return [new ErrorNode(`No agents match "${this.filterQuery}"`)];
      }

      return filtered.map((agent) => new AgentNode(agent, org.slug));
    } catch (error) {
      if (error instanceof Error) {
        return [new ErrorNode(error.message)];
      }
      return [new ErrorNode("Unknown error occurred")];
    }
  }

  private applyFilter(agents: Agent[]): Agent[] {
    if (!this.filterQuery) {
      return agents;
    }
    const q = this.filterQuery.toLowerCase();
    return agents.filter(
      (a) =>
        a.name?.toLowerCase().includes(q) ||
        a.hostname?.toLowerCase().includes(q) ||
        a.meta_data?.some((tag) => tag.toLowerCase().includes(q)),
    );
  }
}

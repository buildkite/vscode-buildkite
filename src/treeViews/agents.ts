import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { AuthManager } from "../api/auth";
import { Agent } from "../api/types";
import { AgentNode } from "./nodes/agentNode";
import { ErrorNode } from "./nodes/errorNode";
import { NoTokenNode } from "./nodes/noTokenNode";

type AgentsTreeNode = AgentNode | ErrorNode | NoTokenNode;

export class AgentsTreeProvider
  implements vscode.TreeDataProvider<AgentsTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    AgentsTreeNode | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: CachedApiClient;
  private filterQuery = "";

  constructor() {
    this.client = new CachedApiClient();
  }

  async refresh(): Promise<void> {
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
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: AgentsTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentsTreeNode): Promise<AgentsTreeNode[]> {
    const token = await AuthManager.getToken();

    try {
      if (element) {
        return [];
      }

      if (!token) {
        return [new NoTokenNode()];
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

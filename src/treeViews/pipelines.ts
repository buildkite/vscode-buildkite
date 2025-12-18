import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { AuthManager } from "../api/auth";
import { PipelineNode } from "./nodes/pipelineNode";
import { BuildNode } from "./nodes/buildNode";
import { NoTokenNode } from "./nodes/noTokenNode";
import { ErrorNode } from "./nodes/errorNode";

type PipelineTreeNode = PipelineNode | BuildNode | NoTokenNode | ErrorNode;

export class PipelinesTreeProvider
  implements vscode.TreeDataProvider<PipelineTreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    PipelineTreeNode | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: BuildkiteClient;

  constructor() {
    this.client = new BuildkiteClient();
  }

  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(element: PipelineTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: PipelineTreeNode,
  ): Promise<PipelineTreeNode[]> {
    const token = await AuthManager.getToken();
    if (!token) {
      return [new NoTokenNode()];
    }

    try {
      if (!element) {
        const org = await this.client.getOrganization();
        const pipelines = await this.client.getPipelines(org.slug);

        if (pipelines.length === 0) {
          return [new ErrorNode("No pipelines found")];
        }

        // Note: API returns max 100 pipelines per page
        return pipelines.map((p) => new PipelineNode(p, org.slug));
      }

      // Pipeline level - show builds
      if (element instanceof PipelineNode) {
        const builds = await this.client.getBuilds(
          element.orgSlug,
          element.pipeline.slug,
          10,
        );

        if (builds.length === 0) {
          return [new ErrorNode("No builds found")];
        }

        return builds.map(
          (b) => new BuildNode(b, element.pipeline, element.orgSlug),
        );
      }

      return [];
    } catch (error) {
      if (error instanceof Error) {
        return [new ErrorNode(error.message)];
      }
      return [new ErrorNode("Unknown error occurred")];
    }
  }
}

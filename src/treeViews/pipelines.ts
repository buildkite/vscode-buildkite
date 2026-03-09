import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { AuthManager } from "../api/auth";
import { PipelineNode } from "./nodes/pipelineNode";
import { BuildNode } from "./nodes/buildNode";
import { JobNode } from "./nodes/jobNode";
import { ArtifactsFolderNode } from "./nodes/artifactsFolderNode";
import { ArtifactNode } from "./nodes/artifactNode";
import { ErrorNode } from "./nodes/errorNode";
import { NoTokenNode } from "./nodes/noTokenNode";
import { Build, BuildState } from "../api/types";
import { Logger } from "../job/jobLogOutput";

type PipelineTreeNode =
  | PipelineNode
  | BuildNode
  | JobNode
  | ArtifactsFolderNode
  | ArtifactNode
  | ErrorNode
  | NoTokenNode;

// Polling interval for running builds (in milliseconds)
const RUNNING_BUILD_POLL_INTERVAL = 10000; // 10 seconds

// Build states that should be polled for updates
// https://buildkite.com/docs/pipelines/configure/notifications#build-states
const ACTIVE_BUILD_STATES: BuildState[] = [
  "running",
  "scheduled",
  "creating",
  "canceling",
];

interface PollingContext {
  buildId: string;
  buildNumber: number;
  orgSlug: string;
  pipelineSlug: string;
  timer: NodeJS.Timeout;
  retryCount: number;
}

const MAX_RETRY_ATTEMPTS = 3;

export class PipelinesTreeProvider
  implements vscode.TreeDataProvider<PipelineTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    PipelineTreeNode | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: BuildkiteClient;
  private activePollers = new Map<string, PollingContext>();
  private buildCache = new Map<string, Build>();

  constructor() {
    this.client = new BuildkiteClient();
  }

  async refresh(): Promise<void> {
    this.stopAllPolling();
    this._onDidChangeTreeData.fire(null);
  }
  
  private stopAllPolling(): void {
    this.activePollers.forEach((poller) => clearTimeout(poller.timer));
    this.activePollers.clear();
    this.buildCache.clear();
  }

  getTreeItem(element: PipelineTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: PipelineTreeNode,
  ): Promise<PipelineTreeNode[]> {
    const token = await AuthManager.getToken();
    
    try {
      if (!element) {
        if (!token) {
          return [new NoTokenNode()];
        }
        
        const org = await this.client.getOrganization();
        const pipelines = await this.client.getPipelines(org.slug);

        if (pipelines.length === 0) {
          return [new ErrorNode("No pipelines found")];
        }

        return pipelines.map((p) => new PipelineNode(p, org.slug));
      }

      if (element instanceof PipelineNode) {
        const builds = await this.client.getBuilds(
          element.orgSlug,
          element.pipeline.slug,
          10,
        );

        if (builds.length === 0) {
          return [new ErrorNode("No builds found")];
        }

        // Cache builds and start polling for active ones
        builds.forEach((build) => {
          this.buildCache.set(build.id, build);
          if (ACTIVE_BUILD_STATES.includes(build.state)) {
            this.startPolling(
              build.id,
              build.number,
              element.orgSlug,
              element.pipeline.slug,
            );
          }
        });

        // Display from cache (polling may have updated state)
        return builds.map((build) => {
          const cached = this.buildCache.get(build.id) || build;
          return new BuildNode(cached, element.pipeline, element.orgSlug);
        });
      }

      if (element instanceof BuildNode) {
        const logger = Logger.getInstance();
        logger.debug(`Fetching jobs for build #${element.build.number}`);

        try {
          const jobs = await this.client.getJobs(
            element.orgSlug,
            element.pipeline.slug,
            element.build.number,
          );

          const children: PipelineTreeNode[] = [];

          if (jobs.length === 0) {
            if (
              element.build.state === "scheduled" ||
              element.build.state === "creating" ||
              element.build.state === "not_run"
            ) {
              children.push(
                new ErrorNode(
                  "No jobs available yet. Jobs will appear when the build starts.",
                ),
              );
            } else {
              children.push(new ErrorNode("No jobs found"));
            }
          } else {
            children.push(
              ...jobs.map(
                (job) =>
                  new JobNode(
                    job,
                    element.build.number,
                    element.pipeline.slug,
                    element.orgSlug,
                  ),
              ),
            );
          }

          children.push(
            new ArtifactsFolderNode(
              element.build.number,
              element.pipeline,
              element.orgSlug,
            ),
          );

          return children;
        } catch (error) {
          logger.error(`Failed to fetch jobs for build #${element.build.number}`, error as Error);
          if (error instanceof Error) {
            return [new ErrorNode(`Failed to load jobs: ${error.message}`)];
          }
          return [new ErrorNode("Failed to load jobs")];
        }
      }

      if (element instanceof JobNode) {
        try {
          const artifacts = await this.client.getJobArtifacts(
            element.orgSlug,
            element.pipelineSlug,
            element.buildNumber,
            element.job.id,
          );

          if (artifacts.length === 0) {
            return [new ErrorNode("No artifacts for this job")];
          }

          return artifacts.map((artifact) => new ArtifactNode(artifact));
        } catch (error) {
          if (error instanceof Error) {
            return [new ErrorNode(`Failed to load artifacts: ${error.message}`)];
          }
          return [new ErrorNode("Failed to load artifacts")];
        }
      }

      if (element instanceof ArtifactsFolderNode) {
        try {
          const artifacts = await this.client.getArtifacts(
            element.orgSlug,
            element.pipeline.slug,
            element.buildNumber,
          );

          if (artifacts.length === 0) {
            return [new ErrorNode("No artifacts found")];
          }

          return artifacts.map((artifact) => new ArtifactNode(artifact));
        } catch (error) {
          if (error instanceof Error) {
            return [new ErrorNode(`Failed to load artifacts: ${error.message}`)];
          }
          return [new ErrorNode("Failed to load artifacts")];
        }
      }

      return [];
    } catch (error) {
      if (error instanceof Error) {
        return [new ErrorNode(error.message)];
      }
      return [new ErrorNode("Unknown error occurred")];
    }
  }

  private startPolling(
    buildId: string,
    buildNumber: number,
    orgSlug: string,
    pipelineSlug: string,
  ): void {
    if (this.activePollers.has(buildId)) {
      return;
    }

    const poll = async (): Promise<void> => {
      await this.pollBuild(buildId, buildNumber, orgSlug, pipelineSlug);
      if (this.activePollers.has(buildId)) {
        const ctx = this.activePollers.get(buildId)!;
        ctx.timer = setTimeout(poll, RUNNING_BUILD_POLL_INTERVAL);
      }
    };

    this.activePollers.set(buildId, {
      buildId,
      buildNumber,
      orgSlug,
      pipelineSlug,
      timer: setTimeout(poll, RUNNING_BUILD_POLL_INTERVAL),
      retryCount: 0,
    });
  }

  private async pollBuild(
    buildId: string,
    buildNumber: number,
    orgSlug: string,
    pipelineSlug: string,
  ): Promise<void> {
    const context = this.activePollers.get(buildId);
    if (!context) {
      return;
    }

    try {
      const updatedBuild = await this.client.getBuild(
        orgSlug,
        pipelineSlug,
        buildNumber,
      );

      context.retryCount = 0;

      const cachedBuild = this.buildCache.get(buildId);
      this.buildCache.set(buildId, updatedBuild);

      if (!cachedBuild || cachedBuild.state !== updatedBuild.state) {
        this._onDidChangeTreeData.fire(null);
      }

      if (!ACTIVE_BUILD_STATES.includes(updatedBuild.state)) {
        this.stopPolling(buildId);
      }
    } catch {
      context.retryCount++;

      if (context.retryCount >= MAX_RETRY_ATTEMPTS) {
        this.stopPolling(buildId);
      }
    }
  }

  private stopPolling(buildId: string): void {
    const poller = this.activePollers.get(buildId);
    if (poller) clearTimeout(poller.timer);
    this.activePollers.delete(buildId);
    this.buildCache.delete(buildId);
  }

  dispose(): void {
    this.stopAllPolling();
  }
}

import * as vscode from "vscode";
import { CachedApiClient } from "../cache/cachedApiClient";
import { PipelineNode } from "../treeViews/nodes/pipelineNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";
import { error, redactIfCredentialShaped } from "../log";
import { track } from "../analytics/analytics";

export async function createBuild(client: CachedApiClient, node: PipelineNode): Promise<void> {
  try {
    // If node is missing or invalid, handle Command Palette flow
    if (!node || !node.orgSlug || !node.pipeline?.slug) {
      // Fetch orgs available to this token
      const orgs = await client.getOrganization();

      if (!orgs) {
        vscode.window.showErrorMessage("No organizations available for your Buildkite token.");
        return;
      }

      // Fetch pipelines for the selected org
      const pipelines = await client.getPipelines(orgs.slug);
      const selectedItem = await vscode.window.showQuickPick(
        pipelines.map(p => ({ label: p.name, description: p.slug, pipeline: p })),
        { placeHolder: "Select a pipeline" }
      );

      if (!selectedItem) return;

      // Construct a minimal PipelineNode for createBuild
      node = new PipelineNode(selectedItem.pipeline, orgs.slug);
    }

    // get git branch
    const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    const gitApi = gitExtension?.getAPI(1);
    const repo = gitApi?.repositories[0];
    const branch = repo?.state?.HEAD?.name;

    if (!branch) {
      vscode.window.showErrorMessage("Unable to determine branch");
      return;
    }

    // Prepare payload for Buildkite
    const buildPayload = {
      commit: "HEAD", // or use a specific SHA if needed
      branch: branch
    };

    // create build
    const build = await client.createBuild(node.orgSlug, node.pipeline.slug, buildPayload);
    track("build create", { pipeline_uuid: node.pipeline.id, build_uuid: build.id });

    const action = await vscode.window.showInformationMessage(
      `Build #${build.number} created`,
      "View Build"
    );

    // Refresh the tree to show the updated build state
    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();

    if (action === "View Build") {
      track("build view", { pipeline_uuid: node.pipeline.id, build_uuid: build.id });
      vscode.env.openExternal(vscode.Uri.parse(build.web_url));
    }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
    vscode.window.showErrorMessage(`Failed to create build: ${message}`);
    error(`[Build] Failed to create build: ${redactIfCredentialShaped(message + stack)}`);
  }
}
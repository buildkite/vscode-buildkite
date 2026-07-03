import * as assert from "node:assert/strict";
import { PipelinesTreeProvider } from "../treeViews/pipelines";
import { PipelineNode } from "../treeViews/nodes/pipelineNode";
import { ErrorNode } from "../treeViews/nodes/errorNode";
import { ShowAllPipelinesNode } from "../treeViews/nodes/showAllPipelinesNode";
import { AuthManager } from "../api/auth";
import { CachedApiClient } from "../cache/cachedApiClient";
import { Pipeline, PipelineWithBuilds } from "../api/types";

const authManager = {
  resolveSession: async () => ({ token: "test-token" }),
} as unknown as AuthManager;

const pipeline = (slug: string): Pipeline =>
  ({ slug, name: slug } as Pipeline);

function makeClient(overrides: Partial<CachedApiClient>): CachedApiClient {
  return {
    getOrganization: async () => ({ slug: "acme" }),
    getPipelines: async () => [pipeline("one"), pipeline("two"), pipeline("three")],
    getPipelinesByRepository: async (): Promise<PipelineWithBuilds[]> => [],
    ...overrides,
  } as unknown as CachedApiClient;
}

describe("PipelinesTreeProvider workspace filter", () => {
  it("shows all org pipelines when the filter is off", async () => {
    const provider = new PipelinesTreeProvider(authManager, makeClient({}));

    const children = await provider.getChildren();

    assert.equal(children.length, 3);
    assert.ok(children.every((c) => c instanceof PipelineNode));
  });

  it("shows only pipelines matching the workspace remotes, deduped across remotes", async () => {
    const client = makeClient({
      getPipelinesByRepository: async (_org: string, repoUrl: string) => {
        // Both remotes resolve to the same pipeline, plus one extra for SSH
        const matches: Record<string, PipelineWithBuilds[]> = {
          "git@github.com:acme/app.git": [
            { pipeline: pipeline("app"), builds: [] },
            { pipeline: pipeline("app-deploy"), builds: [] },
          ],
          "https://github.com/acme/app": [
            { pipeline: pipeline("app"), builds: [] },
          ],
        };
        return matches[repoUrl] ?? [];
      },
    });
    const provider = new PipelinesTreeProvider(authManager, client, async () => [
      "git@github.com:acme/app.git",
      "https://github.com/acme/app",
    ]);
    provider.setWorkspaceFilter(true);

    const children = await provider.getChildren();

    assert.deepEqual(
      children.map((c) => (c as PipelineNode).pipeline.slug),
      ["app", "app-deploy"],
    );
  });

  it("offers a way out when no pipeline matches the workspace", async () => {
    const provider = new PipelinesTreeProvider(authManager, makeClient({}), async () => [
      "git@github.com:acme/unrelated.git",
    ]);
    provider.setWorkspaceFilter(true);

    const children = await provider.getChildren();

    assert.equal(children.length, 2);
    assert.ok(children[0] instanceof ErrorNode);
    assert.ok(children[1] instanceof ShowAllPipelinesNode);
  });

  it("offers a way out when the workspace has no git remotes", async () => {
    const provider = new PipelinesTreeProvider(authManager, makeClient({}), async () => []);
    provider.setWorkspaceFilter(true);

    const children = await provider.getChildren();

    assert.equal(children.length, 2);
    assert.ok(children[0] instanceof ErrorNode);
    assert.ok(children[1] instanceof ShowAllPipelinesNode);
  });

  it("keeps showing everything if a repository lookup fails", async () => {
    const client = makeClient({
      getPipelinesByRepository: async () => {
        throw new Error("boom");
      },
    });
    const provider = new PipelinesTreeProvider(authManager, client, async () => [
      "git@github.com:acme/app.git",
    ]);
    provider.setWorkspaceFilter(true);

    const children = await provider.getChildren();

    // Failure degrades to the no-match state with an escape hatch, not a throw
    assert.ok(children[0] instanceof ErrorNode);
    assert.ok(children[1] instanceof ShowAllPipelinesNode);

    provider.setWorkspaceFilter(false);
    const unfiltered = await provider.getChildren();
    assert.equal(unfiltered.length, 3);
  });
});

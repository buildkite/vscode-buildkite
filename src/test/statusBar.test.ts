import * as assert from "node:assert/strict";
import { StatusBarManager } from "../statusBar/statusBar";
import { AuthManager } from "../api/auth";
import { CachedApiClient } from "../cache/cachedApiClient";
import { Build, Pipeline, PipelineWithBuilds } from "../api/types";

// Reaches into the manager's private refresh internals so we can drive a
// half-finished refresh deterministically.
type StatusBarInternals = {
  orgSlug: string | undefined;
  workspaceRemoteUrls: string[];
  pipelineBuilds: Map<string, Build[]>;
  matchedPipelines: Pipeline[];
  findMatchingPipelinesAndBuilds(): Promise<void>;
};

describe("StatusBarManager.findMatchingPipelinesAndBuilds", () => {
  let manager: StatusBarManager | undefined;

  afterEach(() => {
    manager?.dispose();
    manager = undefined;
  });

  it("keeps the previously matched builds visible until the refresh completes", async () => {
    // A repo lookup we can resolve on demand, so we can inspect state mid-fetch.
    let resolveFetch: (value: PipelineWithBuilds[]) => void = () => {};
    const fetchPromise = new Promise<PipelineWithBuilds[]>((resolve) => {
      resolveFetch = resolve;
    });
    const client = {
      getPipelinesByRepository: () => fetchPromise,
    } as unknown as CachedApiClient;

    manager = new StatusBarManager({} as unknown as AuthManager, client);
    const internals = manager as unknown as StatusBarInternals;

    const priorBuilds = [{ number: 1, state: "passed" } as Build];
    internals.orgSlug = "acme";
    internals.workspaceRemoteUrls = ["https://github.com/foo/bar"];
    internals.pipelineBuilds = new Map([["deploy", priorBuilds]]);

    const refresh = internals.findMatchingPipelinesAndBuilds();

    // Mid-flight the map must still hold the complete prior data. The old code
    // cleared it before awaiting the network, which briefly rendered "no
    // pipeline" whenever two refreshes overlapped.
    assert.deepEqual(
      internals.pipelineBuilds.get("deploy"),
      priorBuilds,
      "previous builds must stay visible while the refresh is in flight",
    );

    const freshBuilds = [{ number: 2, state: "running" } as Build];
    resolveFetch([
      { pipeline: { slug: "deploy", name: "Deploy" } as Pipeline, builds: freshBuilds },
    ]);
    await refresh;

    assert.deepEqual(internals.pipelineBuilds.get("deploy"), freshBuilds);
    assert.equal(internals.matchedPipelines.length, 1);
    assert.equal(internals.matchedPipelines[0].slug, "deploy");
  });
});

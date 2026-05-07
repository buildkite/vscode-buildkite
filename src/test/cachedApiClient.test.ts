import * as assert from "node:assert/strict";
import { CachedApiClient } from "../cache/cachedApiClient";
import { BuildkiteClient, Organization } from "../api/client";
import { Build, Pipeline } from "../api/types";

class FakeClient {
  org: Organization = {
    id: "1",
    graphql_id: "g1",
    url: "u",
    web_url: "w",
    name: "acme",
    slug: "acme",
    pipelines_url: "p",
    agents_url: "a",
    emojis_url: "e",
    created_at: "now",
  };
  orgCalls = 0;
  pipelinesCalls = 0;
  buildsCalls = 0;
  invalidateOrgCacheCalls = 0;
  rebuildCalls = 0;

  async getOrganization(): Promise<Organization> {
    this.orgCalls += 1;
    return this.org;
  }

  async getPipelines(): Promise<Pipeline[]> {
    this.pipelinesCalls += 1;
    return [];
  }

  async getBuilds(org: string, pipeline: string, perPage = 10): Promise<Build[]> {
    void org;
    void pipeline;
    void perPage;
    this.buildsCalls += 1;
    return [];
  }

  async rebuildBuild(org: string, pipeline: string, n: number): Promise<Build> {
    void org;
    void pipeline;
    void n;
    this.rebuildCalls += 1;
    return { number: 1 } as Build;
  }

  invalidateOrgCache(): void {
    this.invalidateOrgCacheCalls += 1;
  }
}

describe("CachedApiClient", () => {
  let fake: FakeClient;
  let client: CachedApiClient;

  beforeEach(() => {
    fake = new FakeClient();
    client = new CachedApiClient(fake as unknown as BuildkiteClient);
  });

  afterEach(() => {
    client.dispose();
  });

  it("hits the underlying client once, then serves from cache", async () => {
    await client.getOrganization();
    await client.getOrganization();
    await client.getOrganization();
    assert.equal(fake.orgCalls, 1);
  });

  it("caches per orgSlug for getPipelines", async () => {
    await client.getPipelines("acme");
    await client.getPipelines("acme");
    await client.getPipelines("other");
    assert.equal(fake.pipelinesCalls, 2);
  });

  it("clearCache wipes the response cache but does not touch the underlying client", async () => {
    await client.getOrganization();
    client.clearCache();
    await client.getOrganization();

    assert.equal(fake.orgCalls, 2);
    assert.equal(fake.invalidateOrgCacheCalls, 0);
  });

  it("clearAll wipes the cache and invalidates the underlying client too", async () => {
    await client.getOrganization();
    client.clearAll();

    assert.equal(fake.invalidateOrgCacheCalls, 1);

    await client.getOrganization();
    assert.equal(fake.orgCalls, 2);
  });

  it("mutating actions drop the relevant pipeline's cached entries", async () => {
    await client.getBuilds("acme", "deploy");
    await client.getBuilds("acme", "deploy");
    assert.equal(fake.buildsCalls, 1, "second read should be a cache hit");

    await client.rebuildBuild("acme", "deploy", 1);

    await client.getBuilds("acme", "deploy");
    assert.equal(fake.buildsCalls, 2, "rebuild should have invalidated the pipeline cache");
  });
});

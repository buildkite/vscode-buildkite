import * as assert from "node:assert/strict";
import { BuildkiteClient } from "../api/client";
import { AuthManager } from "../api/auth";
import { Build, Pipeline } from "../api/types";

function makePipeline(slug: string, repository: string): Pipeline {
  return {
    id: slug,
    graphql_id: slug,
    url: "",
    web_url: "",
    name: slug,
    slug,
    repository,
    description: null,
    default_branch: "main",
    created_at: "",
    archived_at: null,
    scheduled_builds_count: 0,
    running_builds_count: 0,
    scheduled_jobs_count: 0,
    running_jobs_count: 0,
    waiting_jobs_count: 0,
  };
}

class StubClient extends BuildkiteClient {
  capturedFilters: string[] = [];
  pipelinesResponse: Pipeline[] = [];
  buildsResponses: Map<string, Build[] | Error> = new Map();
  buildsCalls = 0;

  constructor() {
    super(null as unknown as AuthManager);
  }

  protected override async getAllPages<T>(endpoint: string): Promise<T[]> {
    const match = endpoint.match(/[?&]repository=([^&]+)/);
    if (match) {
      this.capturedFilters.push(decodeURIComponent(match[1]));
    }
    return this.pipelinesResponse as unknown as T[];
  }

  override async getBuilds(
    orgSlug: string,
    pipelineSlug: string,
  ): Promise<Build[]> {
    void orgSlug;
    this.buildsCalls += 1;
    const response = this.buildsResponses.get(pipelineSlug);
    if (response instanceof Error) {
      throw response;
    }
    return response ?? [];
  }
}

describe("BuildkiteClient.getPipelinesByRepository", () => {
  let stub: StubClient;

  beforeEach(() => {
    stub = new StubClient();
  });

  it("filters out substring-match false positives", async () => {
    stub.pipelinesResponse = [
      makePipeline("web", "https://github.com/acme/web.git"),
      makePipeline("web-frontend", "https://github.com/acme/web-frontend.git"),
      makePipeline("web-backend", "git@github.com:acme/web-backend.git"),
    ];

    const result = await stub.getPipelinesByRepository(
      "acme",
      "https://github.com/acme/web",
    );

    assert.deepEqual(
      result.map((r) => r.pipeline.slug),
      ["web"],
    );
  });

  it("uses owner/repo as the REST filter for normalizable URLs", async () => {
    await stub.getPipelinesByRepository(
      "acme",
      "git@github.com:acme/web.git",
    );

    assert.deepEqual(stub.capturedFilters, ["acme/web"]);
  });

  it("matches across URL formats (SSH input, HTTPS pipeline)", async () => {
    stub.pipelinesResponse = [
      makePipeline("web", "https://github.com/acme/web.git"),
    ];

    const result = await stub.getPipelinesByRepository(
      "acme",
      "git@github.com:acme/web.git",
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].pipeline.slug, "web");
  });

  it("falls back to the raw URL when the input does not normalize", async () => {
    stub.pipelinesResponse = [makePipeline("p", "weird://thing")];

    const result = await stub.getPipelinesByRepository("acme", "weird://thing");

    assert.deepEqual(stub.capturedFilters, ["weird://thing"]);
    assert.equal(result.length, 1);
  });

  it("returns builds: [] for pipelines whose getBuilds fails, keeps others", async () => {
    stub.pipelinesResponse = [
      makePipeline("a", "https://github.com/acme/repo.git"),
      makePipeline("b", "https://github.com/acme/repo.git"),
      makePipeline("c", "https://github.com/acme/repo.git"),
    ];
    stub.buildsResponses.set("a", [{ number: 1 } as Build]);
    stub.buildsResponses.set("b", new Error("404 pipeline deleted"));
    stub.buildsResponses.set("c", [{ number: 2 } as Build]);

    const result = await stub.getPipelinesByRepository(
      "acme",
      "https://github.com/acme/repo",
    );

    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((r) => ({ slug: r.pipeline.slug, count: r.builds.length })),
      [
        { slug: "a", count: 1 },
        { slug: "b", count: 0 },
        { slug: "c", count: 1 },
      ],
    );
  });
});

import * as assert from "node:assert/strict";
import { BuildkiteClient } from "../api/client";
import { AuthManager } from "../api/auth";
import { Build, Pipeline } from "../api/types";

type FetchArgs = { url: string; init?: RequestInit };

// Replace global fetch for the duration of a test, returns the captured calls
function withFetch(handler: (url: string) => Response | Promise<Response>): {
  calls: FetchArgs[];
  restore: () => void;
} {
  const calls: FetchArgs[] = [];
  const original = global.fetch;
  // @ts-expect-error swapping a global for tests
  global.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url);
  };
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

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

// A token is all BuildkiteClient.fetch needs from the auth manager
const fakeAuth = {
  resolveSession: async () => ({ token: "test-token", invalidate: async () => {} }),
} as unknown as AuthManager;

// Serves the pipeline list on the repository-search endpoint and per-pipeline
// builds keyed by slug; a number value stands in for an HTTP error status.
function serve(
  pipelines: Pipeline[],
  builds: Record<string, Build[] | number> = {},
): (url: string) => Response {
  return (url: string): Response => {
    if (/\/pipelines\?repository=/.test(url)) {
      return jsonResponse(pipelines);
    }
    const match = url.match(/\/pipelines\/([^/]+)\/builds/);
    if (match) {
      const spec = builds[match[1]];
      if (typeof spec === "number") {
        return new Response("error", { status: spec });
      }
      return jsonResponse(spec ?? []);
    }
    return new Response("unexpected request", { status: 500 });
  };
}

function listFilter(calls: FetchArgs[]): string | null {
  const listCall = calls.find((c) => c.url.includes("/pipelines?repository="));
  return listCall ? new URL(listCall.url).searchParams.get("repository") : null;
}

describe("BuildkiteClient.getPipelinesByRepository", () => {
  it("filters out substring-match false positives", async () => {
    const stub = withFetch(
      serve([
        makePipeline("web", "https://github.com/acme/web.git"),
        makePipeline("web-frontend", "https://github.com/acme/web-frontend.git"),
        makePipeline("web-backend", "git@github.com:acme/web-backend.git"),
      ]),
    );

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "https://github.com/acme/web",
      );

      assert.deepEqual(
        result.map((r) => r.pipeline.slug),
        ["web"],
      );
    } finally {
      stub.restore();
    }
  });

  it("uses owner/repo as the URL-encoded REST filter for normalizable URLs", async () => {
    const stub = withFetch(serve([]));

    try {
      await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "git@github.com:acme/web.git",
      );

      assert.equal(listFilter(stub.calls), "acme/web");
      // the slash must be percent-encoded on the wire
      assert.match(stub.calls[0].url, /repository=acme%2Fweb/);
    } finally {
      stub.restore();
    }
  });

  it("matches across URL formats (SSH input, HTTPS pipeline)", async () => {
    const stub = withFetch(
      serve([makePipeline("web", "https://github.com/acme/web.git")]),
    );

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "git@github.com:acme/web.git",
      );

      assert.equal(result.length, 1);
      assert.equal(result[0].pipeline.slug, "web");
    } finally {
      stub.restore();
    }
  });

  it("excludes pipelines on a different host with the same owner/repo", async () => {
    const stub = withFetch(
      serve([
        makePipeline("github", "https://github.com/acme/web.git"),
        makePipeline("gitlab", "https://gitlab.com/acme/web.git"),
      ]),
    );

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "https://github.com/acme/web",
      );

      assert.deepEqual(
        result.map((r) => r.pipeline.slug),
        ["github"],
      );
    } finally {
      stub.restore();
    }
  });

  it("supports nested namespaces (GitLab subgroups) and excludes sibling subgroups", async () => {
    const stub = withFetch(
      serve([
        makePipeline("repo", "https://gitlab.com/group/subgroup/repo.git"),
        makePipeline("sibling", "https://gitlab.com/group/other/repo.git"),
      ]),
    );

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "https://gitlab.com/group/subgroup/repo",
      );

      assert.equal(listFilter(stub.calls), "group/subgroup/repo");
      assert.match(stub.calls[0].url, /repository=group%2Fsubgroup%2Frepo/);
      assert.deepEqual(
        result.map((r) => r.pipeline.slug),
        ["repo"],
      );
    } finally {
      stub.restore();
    }
  });

  it("falls back to the raw URL when the input does not normalize, still rejecting substring matches", async () => {
    const stub = withFetch(
      serve([
        makePipeline("exact", "weird://thing"),
        makePipeline("superstring", "weird://thing-2"),
      ]),
    );

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "weird://thing",
      );

      assert.equal(listFilter(stub.calls), "weird://thing");
      assert.deepEqual(
        result.map((r) => r.pipeline.slug),
        ["exact"],
      );
    } finally {
      stub.restore();
    }
  });

  it("paginates the lookup across Link-header pages", async () => {
    const page2 =
      "https://api.buildkite.com/v2/organizations/acme/pipelines?repository=acme%2Fweb&per_page=100&page=2";
    const stub = withFetch((url) => {
      if (/\/pipelines\?repository=/.test(url)) {
        if (url.includes("page=2")) {
          return jsonResponse([
            makePipeline("web-2", "https://github.com/acme/web.git"),
          ]);
        }
        return jsonResponse(
          [makePipeline("web-1", "https://github.com/acme/web.git")],
          { Link: `<${page2}>; rel="next"` },
        );
      }
      return jsonResponse([]); // builds
    });

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
        "acme",
        "https://github.com/acme/web",
      );

      assert.deepEqual(
        result.map((r) => r.pipeline.slug),
        ["web-1", "web-2"],
      );
      const listCalls = stub.calls.filter((c) =>
        c.url.includes("/pipelines?repository="),
      );
      assert.equal(listCalls.length, 2, "should follow the next page");
    } finally {
      stub.restore();
    }
  });

  it("returns builds: [] for pipelines whose getBuilds fails, keeps others", async () => {
    const stub = withFetch(
      serve(
        [
          makePipeline("a", "https://github.com/acme/repo.git"),
          makePipeline("b", "https://github.com/acme/repo.git"),
          makePipeline("c", "https://github.com/acme/repo.git"),
        ],
        {
          a: [{ number: 1 } as Build],
          b: 404, // archived/deleted pipeline
          c: [{ number: 2 } as Build],
        },
      ),
    );

    try {
      const result = await new BuildkiteClient(fakeAuth).getPipelinesByRepository(
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
    } finally {
      stub.restore();
    }
  });
});

describe("BuildkiteClient credential origin guard", () => {
  it("sends the bearer token for absolute URLs on the API origin", async () => {
    const stub = withFetch(() => new Response("log output", { status: 200 }));

    try {
      const text = await new BuildkiteClient(fakeAuth).getJobLog({
        raw_log_url: "https://api.buildkite.com/v2/organizations/acme/pipelines/web/builds/1/jobs/j1/log.txt",
      } as never);

      assert.equal(text, "log output");
      const headers = stub.calls[0].init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-token");
    } finally {
      stub.restore();
    }
  });

  it("refuses to send credentials to an absolute URL on a different origin", async () => {
    const stub = withFetch(() => new Response("should never be fetched", { status: 200 }));

    try {
      await assert.rejects(
        new BuildkiteClient(fakeAuth).downloadArtifact("https://evil.example.com/artifact"),
        /Refusing to send Buildkite credentials to https:\/\/evil\.example\.com/,
      );
      assert.equal(stub.calls.length, 0, "no request should have been made");
    } finally {
      stub.restore();
    }
  });

  it("refuses to send credentials to a same-host URL with a different scheme", async () => {
    const stub = withFetch(() => new Response("should never be fetched", { status: 200 }));

    try {
      await assert.rejects(
        new BuildkiteClient(fakeAuth).downloadArtifact("http://api.buildkite.com/v2/artifact"),
        /Refusing to send Buildkite credentials/,
      );
      assert.equal(stub.calls.length, 0, "no request should have been made");
    } finally {
      stub.restore();
    }
  });

  it("refuses malformed absolute URLs", async () => {
    const stub = withFetch(() => new Response("should never be fetched", { status: 200 }));

    try {
      await assert.rejects(
        new BuildkiteClient(fakeAuth).downloadArtifact("https://"),
        /Refusing to send credentials to malformed URL/,
      );
      assert.equal(stub.calls.length, 0, "no request should have been made");
    } finally {
      stub.restore();
    }
  });
});

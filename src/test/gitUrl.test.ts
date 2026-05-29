import * as assert from "node:assert/strict";
import {
  normalizeGitUrl,
  gitUrlsMatch,
  repositorySearchFilter,
  repositoryCacheKey,
} from "../utils/gitUrl";

describe("normalizeGitUrl", () => {
  it("parses the common URL formats to host/owner/repo", () => {
    assert.deepEqual(normalizeGitUrl("https://github.com/acme/web.git"), {
      host: "github.com",
      owner: "acme",
      repo: "web",
    });
    assert.deepEqual(normalizeGitUrl("git@github.com:acme/web.git"), {
      host: "github.com",
      owner: "acme",
      repo: "web",
    });
    assert.deepEqual(normalizeGitUrl("ssh://git@github.com/acme/web"), {
      host: "github.com",
      owner: "acme",
      repo: "web",
    });
    assert.deepEqual(normalizeGitUrl("ssh://github.com/acme/web"), {
      host: "github.com",
      owner: "acme",
      repo: "web",
    });
  });

  it("captures nested namespaces (e.g. GitLab subgroups) as the owner", () => {
    assert.deepEqual(normalizeGitUrl("https://gitlab.com/group/subgroup/repo"), {
      host: "gitlab.com",
      owner: "group/subgroup",
      repo: "repo",
    });
    assert.deepEqual(
      normalizeGitUrl("git@gitlab.com:group/subgroup/deep/repo.git"),
      { host: "gitlab.com", owner: "group/subgroup/deep", repo: "repo" },
    );
  });

  it("lowercases the host but preserves owner/repo case", () => {
    assert.deepEqual(normalizeGitUrl("https://GitHub.com/Acme/Web"), {
      host: "github.com",
      owner: "Acme",
      repo: "Web",
    });
  });

  it("returns null for unparseable or single-segment URLs", () => {
    assert.equal(normalizeGitUrl(""), null);
    assert.equal(normalizeGitUrl("not a url"), null);
    assert.equal(normalizeGitUrl("https://github.com/onlyone"), null);
    assert.equal(normalizeGitUrl("git@github.com:onlyone"), null);
  });
});

describe("gitUrlsMatch", () => {
  it("matches the same repo across URL formats", () => {
    assert.ok(
      gitUrlsMatch("git@github.com:acme/web.git", "https://github.com/acme/web"),
    );
    assert.ok(
      gitUrlsMatch(
        "git@gitlab.com:group/subgroup/repo.git",
        "https://gitlab.com/group/subgroup/repo",
      ),
    );
  });

  it("is case-insensitive on owner and repo", () => {
    assert.ok(
      gitUrlsMatch("https://github.com/ACME/Web", "git@github.com:acme/web.git"),
    );
  });

  it("rejects substring false positives and host mismatches", () => {
    assert.equal(
      gitUrlsMatch(
        "https://github.com/acme/web",
        "https://github.com/acme/web-staging",
      ),
      false,
    );
    assert.equal(
      gitUrlsMatch("https://github.com/acme/web", "https://gitlab.com/acme/web"),
      false,
    );
  });

  it("falls back to a canonical raw comparison when a URL can't be parsed", () => {
    assert.ok(gitUrlsMatch("weird://thing.git", "weird://thing"));
    assert.equal(gitUrlsMatch("weird://thing", "weird://thing-2"), false);
    // one side parses, the other doesn't
    assert.equal(gitUrlsMatch("https://github.com/acme/web", "weird://thing"), false);
  });
});

describe("repositorySearchFilter", () => {
  it("narrows parseable URLs to owner/repo", () => {
    assert.equal(repositorySearchFilter("git@github.com:acme/web.git"), "acme/web");
    assert.equal(
      repositorySearchFilter("https://gitlab.com/group/subgroup/repo"),
      "group/subgroup/repo",
    );
  });

  it("returns the raw URL when it can't be parsed", () => {
    assert.equal(repositorySearchFilter("weird://thing"), "weird://thing");
  });
});

describe("repositoryCacheKey", () => {
  it("collapses a repo's SSH and HTTPS remotes to one key", () => {
    assert.equal(
      repositoryCacheKey("git@github.com:acme/web.git"),
      repositoryCacheKey("https://github.com/acme/web"),
    );
  });

  it("keeps the same owner/repo on different hosts distinct", () => {
    assert.notEqual(
      repositoryCacheKey("https://github.com/acme/web"),
      repositoryCacheKey("https://gitlab.com/acme/web"),
    );
  });

  it("is case-insensitive", () => {
    assert.equal(repositoryCacheKey("https://github.com/ACME/Web"), "github.com/acme/web");
  });

  it("falls back to a canonical raw form for unparseable URLs", () => {
    assert.equal(repositoryCacheKey("weird://THING.git/"), "weird://thing");
  });
});

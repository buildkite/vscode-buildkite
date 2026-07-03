import * as assert from "node:assert/strict";
import { stripUrlCredentials } from "../utils/workspaceRemotes";
import { gitUrlsMatch } from "../utils/gitUrl";

describe("stripUrlCredentials", () => {
  it("strips user:token userinfo from an HTTPS remote", () => {
    assert.equal(
      stripUrlCredentials("https://x-access-token:ghs_abc123@github.com/acme/app.git"),
      "https://github.com/acme/app.git",
    );
  });

  it("strips a bare token userinfo from an HTTPS remote", () => {
    assert.equal(
      stripUrlCredentials("https://ghp_abc123@github.com/acme/app.git"),
      "https://github.com/acme/app.git",
    );
  });

  it("returns a credential-free HTTPS remote byte-for-byte unchanged", () => {
    const url = "https://github.com/acme/app.git";
    assert.equal(stripUrlCredentials(url), url);
  });

  it("leaves SSH remotes alone: their user is structural, not a secret", () => {
    for (const url of [
      "git@github.com:acme/app.git",
      "ssh://git@github.com/acme/app.git",
    ]) {
      assert.equal(stripUrlCredentials(url), url);
    }
  });

  // The failure this guards against: gitUrlsMatch parses the userinfo into the
  // host ("x-access-token:...@github.com" != "github.com"), so a credentialed
  // remote matched no pipeline until it was stripped.
  it("makes a credentialed remote match the pipeline's configured URL", () => {
    const credentialed = "https://x-access-token:ghs_abc123@github.com/acme/app.git";
    const pipelineRepo = "git@github.com:acme/app.git";

    assert.ok(!gitUrlsMatch(pipelineRepo, credentialed), "raw URL must demonstrate the bug");
    assert.ok(gitUrlsMatch(pipelineRepo, stripUrlCredentials(credentialed)));
  });
});

import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { PostHog } from "posthog-node";
import {
  track,
  identifyUser,
  resetIdentity,
  setClientForTesting,
} from "../analytics/analytics";

// Records the calls track()/identifyUser() make so we can assert distinctId,
// event name and property shape without a real PostHog client or network.
class FakeClient {
  captures: { distinctId: string; event: string; properties?: Record<string, unknown> }[] = [];
  identifies: { distinctId: string; properties?: Record<string, unknown> }[] = [];
  aliases: { distinctId: string; alias: string }[] = [];
  capture(msg: { distinctId: string; event: string; properties?: Record<string, unknown> }): void {
    this.captures.push(msg);
  }
  identify(msg: { distinctId: string; properties?: Record<string, unknown> }): void {
    this.identifies.push(msg);
  }
  alias(msg: { distinctId: string; alias: string }): void {
    this.aliases.push(msg);
  }
  async shutdown(): Promise<void> {}
}

describe("analytics", () => {
  let fake: FakeClient;
  const machineId = vscode.env.machineId;

  beforeEach(() => {
    fake = new FakeClient();
    resetIdentity();
    setClientForTesting(fake as unknown as PostHog);
  });

  afterEach(() => {
    setClientForTesting(undefined);
    resetIdentity();
  });

  describe("track() gating", () => {
    it("no-ops when no client is set", () => {
      setClientForTesting(undefined);
      assert.doesNotThrow(() => track("build view"));
      // re-attaching a client must not surface the suppressed event
      setClientForTesting(fake as unknown as PostHog);
      assert.equal(fake.captures.length, 0);
    });

    // Guards the auth-funnel fix: events fired before sign-in must still be
    // delivered, attributed to the anonymous machine id.
    it("fires against the anonymous machine id before identification", () => {
      track("auth login", { method: "browser" });

      assert.equal(fake.captures.length, 1);
      const [event] = fake.captures;
      assert.equal(event.event, "auth login");
      assert.equal(event.distinctId, machineId);
      assert.equal(event.properties?.method, "browser");
      assert.equal(event.properties?.channel, "vscode");
      assert.equal(event.properties?.organization, undefined);
    });
  });

  describe("event shape after identification", () => {
    it("attributes events to the user id and stamps the organization", () => {
      identifyUser("user-1", "acme");
      track("job retry", { job_uuid: "job-1" });

      const [event] = fake.captures;
      assert.equal(event.event, "job retry");
      assert.equal(event.distinctId, "user-1");
      assert.equal(event.properties?.organization, "acme");
      assert.equal(event.properties?.channel, "vscode");
      assert.equal(event.properties?.job_uuid, "job-1");
    });

    it("reverts to the anonymous id after resetIdentity", () => {
      identifyUser("user-1", "acme");
      resetIdentity();
      track("docs search", { query: "pipelines" });

      const [event] = fake.captures;
      assert.equal(event.distinctId, machineId);
      assert.equal(event.properties?.organization, undefined);
    });
  });

  describe("identifyUser", () => {
    it("aliases the anonymous id onto the user and identifies them", () => {
      identifyUser("user-1", "acme");

      assert.deepEqual(fake.aliases, [{ distinctId: "user-1", alias: machineId }]);
      assert.equal(fake.identifies.length, 1);
      assert.equal(fake.identifies[0].distinctId, "user-1");
      assert.equal(fake.identifies[0].properties?.organization, "acme");
    });

    // Re-aliasing on every identify would risk merging distinct users that
    // share a machine id, so alias only fires on the first identification.
    it("does not re-alias on a subsequent identification", () => {
      identifyUser("user-1", "acme");
      identifyUser("user-1", "acme");

      assert.equal(fake.aliases.length, 1);
    });

    // Sign-out clears the user but must NOT re-open the alias: PostHog refuses to
    // alias the same machine id onto a second user (the call is dropped with an
    // ingestion warning), so re-aliasing is pointless.
    it("does not re-alias after sign-out and sign-in as a different user", () => {
      identifyUser("user-1", "acme");
      resetIdentity();
      identifyUser("user-2", "globex");

      assert.equal(fake.aliases.length, 1);
      assert.equal(fake.aliases[0].distinctId, "user-1");
    });
  });
});

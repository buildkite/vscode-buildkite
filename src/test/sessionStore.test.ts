import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { SessionStore, StoredSession } from "../api/oauth/sessionStore";
import { SESSIONS_SECRET_KEY } from "../api/oauth/constants";
import { initLogger } from "../log";

// Fake SecretStorage backed by a Map, fires onDidChange on writes so
// we can exercise the cross window path
class FakeSecretStorage implements vscode.SecretStorage {
  private readonly map = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
  readonly onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    this.emitter.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
    this.emitter.fire({ key });
  }

  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }

  // Test helper, simulates another window writing the secret directly so
  // tests can flex SessionStore.onExternalChange without round tripping
  async writeRaw(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    this.emitter.fire({ key });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function session(id: string, refreshToken = `r-${id}`): StoredSession {
  return {
    id,
    accessToken: `a-${id}`,
    refreshToken,
    expiresAt: Date.now() + 60_000,
    scopes: ["read_user"],
    account: { id: `account-${id}`, label: `Account ${id}` },
  };
}

describe("SessionStore", () => {
  let secrets: FakeSecretStorage;
  let store: SessionStore;

  beforeEach(() => {
    secrets = new FakeSecretStorage();
    store = new SessionStore(secrets);
  });

  afterEach(() => {
    store.dispose();
    secrets.dispose();
  });

  it("getAll is empty when nothing has been stored", async () => {
    assert.deepEqual(await store.getAll(), []);
  });

  describe("replace", () => {
    it("stores a session and returns the empty prior set", async () => {
      const s = session("a");
      const previous = await store.replace(s);

      assert.deepEqual(previous, []);
      assert.deepEqual(await store.getAll(), [s]);
    });

    it("returns the previously-stored sessions and replaces them", async () => {
      const first = session("a");
      const second = session("b");

      await store.replace(first);
      const previous = await store.replace(second);

      assert.deepEqual(previous.map((p) => p.id), ["a"]);
      assert.deepEqual((await store.getAll()).map((s) => s.id), ["b"]);
    });

  });

  describe("clearAll", () => {
    it("wipes everything and returns what was there", async () => {
      const s = session("solo");
      await store.replace(s);

      const removed = await store.clearAll();

      assert.deepEqual(removed.map((r) => r.id), ["solo"]);
      assert.deepEqual(await store.getAll(), []);
    });

    it("is fine when there's nothing to clear", async () => {
      assert.deepEqual(await store.clearAll(), []);
    });
  });

  describe("remove", () => {
    it("removes and returns the matching session", async () => {
      const s = session("x");
      await store.replace(s);

      const removed = await store.remove("x");
      assert.deepEqual(removed?.id, "x");
      assert.deepEqual(await store.getAll(), []);
    });

    it("returns undefined for an unknown id", async () => {
      assert.equal(await store.remove("nope"), undefined);
    });
  });

  describe("getById", () => {
    it("finds a stored session", async () => {
      const s = session("a");
      await store.replace(s);
      const found = await store.getById("a");
      assert.equal(found?.id, "a");
    });

    it("returns undefined for a missing id", async () => {
      assert.equal(await store.getById("nope"), undefined);
    });
  });

  describe("swapIfRefreshTokenMatches", () => {
    it("writes when the stored refresh token matches expected", async () => {
      const original = session("a", "r1");
      await store.replace(original);

      const rotated: StoredSession = { ...original, accessToken: "a2", refreshToken: "r2" };
      const wrote = await store.swapIfRefreshTokenMatches(rotated, "r1");

      assert.equal(wrote, true);
      const after = await store.getById("a");
      assert.equal(after?.refreshToken, "r2");
      assert.equal(after?.accessToken, "a2");
    });

    it("does NOT write when the stored refresh token has rotated", async () => {
      const original = session("a", "r1");
      await store.replace(original);

      // Simulate another window having already rotated to r2
      const rotatedElsewhere: StoredSession = { ...original, refreshToken: "r2" };
      await store.swapIfRefreshTokenMatches(rotatedElsewhere, "r1");

      // Now we try to write a rotation based on the stale r1 token
      const stale: StoredSession = { ...original, accessToken: "stale", refreshToken: "r3" };
      const wrote = await store.swapIfRefreshTokenMatches(stale, "r1");

      assert.equal(wrote, false);
      const after = await store.getById("a");
      assert.equal(after?.refreshToken, "r2", "should still hold the other window's rotation");
      assert.equal(after?.accessToken, "a-a", "must not have been overwritten by stale write");
    });

    it("returns false if the session no longer exists", async () => {
      const ghost = session("ghost", "r1");
      const wrote = await store.swapIfRefreshTokenMatches(ghost, "r1");
      assert.equal(wrote, false);
    });
  });

  describe("onExternalChange", () => {
    it("fires when a write to the sessions key happens", async () => {
      let fired = 0;
      store.onExternalChange(() => {
        fired += 1;
      });

      // Anything inside the store writes to the secret -> fires onDidChange
      await store.replace(session("a"));

      assert.ok(fired >= 1, `expected at least one fire, got ${fired}`);
    });

    it("does not fire for unrelated keys", async () => {
      let fired = 0;
      store.onExternalChange(() => {
        fired += 1;
      });

      await secrets.writeRaw("buildkite.something.else", "{}");
      assert.equal(fired, 0);
    });

    it("fires on writes from another window", async () => {
      let fired = 0;
      store.onExternalChange(() => {
        fired += 1;
      });

      // Simulate a separate window mutating the same secret directly
      await secrets.writeRaw(SESSIONS_SECRET_KEY, JSON.stringify([session("from-other-window")]));

      assert.equal(fired, 1);
      const all = await store.getAll();
      assert.deepEqual(all.map((s) => s.id), ["from-other-window"]);
    });
  });

  describe("readRaw resilience", () => {
    let channelLines: string[];
    let originalCreate: typeof vscode.window.createOutputChannel;
    let loggerDisposable: vscode.Disposable | undefined;

    beforeEach(() => {
      channelLines = [];
      originalCreate = vscode.window.createOutputChannel;
      const record = (level: string) => (line: string) => { channelLines.push(`[${level}] ${line}`); };
      const fakeChannel = {
        name: "test",
        logLevel: 1,
        onDidChangeLogLevel: () => ({ dispose: () => {} }),
        appendLine: (line: string) => { channelLines.push(line); },
        append: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
        trace: record("trace"),
        debug: record("debug"),
        info: record("info"),
        warn: record("warn"),
        error: record("error"),
      };
      (vscode.window as unknown as { createOutputChannel: (name: string, opts?: unknown) => unknown }).createOutputChannel = () => fakeChannel;
      loggerDisposable = initLogger();
    });

    afterEach(() => {
      loggerDisposable?.dispose();
      (vscode.window as unknown as { createOutputChannel: typeof vscode.window.createOutputChannel }).createOutputChannel = originalCreate;
    });

    it("returns empty when the stored secret is not valid JSON", async () => {
      await secrets.writeRaw(SESSIONS_SECRET_KEY, "not-json{");
      assert.deepEqual(await store.getAll(), []);
      assert.ok(
        channelLines.some((line) => line.includes("failed to parse")),
        `expected a parse-failure log, got: ${channelLines.join(" | ")}`,
      );
    });

    it("returns empty when the stored secret is not an array", async () => {
      await secrets.writeRaw(SESSIONS_SECRET_KEY, JSON.stringify({ not: "an array" }));
      assert.deepEqual(await store.getAll(), []);
    });

    it("drops malformed entries but keeps valid ones", async () => {
      const good = session("good");
      const bad = { id: "bad", missingFields: true };
      await secrets.writeRaw(SESSIONS_SECRET_KEY, JSON.stringify([good, bad]));
      const all = await store.getAll();
      assert.deepEqual(all.map((s) => s.id), ["good"]);
    });

    it("rejects entries with a non-string scope", async () => {
      const broken = { ...session("a"), scopes: ["read_user", 42] };
      await secrets.writeRaw(SESSIONS_SECRET_KEY, JSON.stringify([broken]));
      assert.deepEqual(await store.getAll(), []);
    });

    it("rejects entries missing the account block", async () => {
      const broken = { ...session("a"), account: undefined };
      await secrets.writeRaw(SESSIONS_SECRET_KEY, JSON.stringify([broken]));
      assert.deepEqual(await store.getAll(), []);
    });
  });
});

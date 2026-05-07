import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { BuildkiteAuthProvider } from "../api/oauth/buildkiteAuthProvider";
import { SessionStore, StoredSession } from "../api/oauth/sessionStore";
import { SESSIONS_SECRET_KEY, REFRESH_LEEWAY_MS } from "../api/oauth/constants";

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

  async seed(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async writeRaw(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    this.emitter.fire({ key });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function session(id: string, overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    accessToken: `at-${id}`,
    refreshToken: `rt-${id}`,
    expiresAt: Date.now() + 60_000,
    scopes: ["read_user"],
    account: { id: `acct-${id}`, label: `Account ${id}` },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

interface CapturedEvent {
  added: string[];
  removed: string[];
  changed: string[];
}

function capture(provider: BuildkiteAuthProvider): { events: CapturedEvent[]; dispose: () => void } {
  const events: CapturedEvent[] = [];
  const sub = provider.onDidChangeSessions((e) => {
    events.push({
      added: (e.added ?? []).map((s) => s.id),
      removed: (e.removed ?? []).map((s) => s.id),
      changed: (e.changed ?? []).map((s) => s.id),
    });
  });
  return { events, dispose: () => sub.dispose() };
}

describe("BuildkiteAuthProvider", () => {
  let secrets: FakeSecretStorage;
  let store: SessionStore;
  let provider: BuildkiteAuthProvider;

  beforeEach(async () => {
    secrets = new FakeSecretStorage();
    store = new SessionStore(secrets);
    provider = new BuildkiteAuthProvider(store);
    await settle();
  });

  afterEach(() => {
    provider.dispose();
    store.dispose();
    secrets.dispose();
  });

  describe("recomputeAndFire (via replace / removeAllSessions)", () => {
    it("fires added when a fresh session is stored", async () => {
      const cap = capture(provider);
      try {
        await store.replace(session("a"));
        await settle();
        assert.ok(cap.events.length >= 1);
        const last = cap.events[cap.events.length - 1];
        assert.deepEqual(last?.added, ["a"]);
      } finally {
        cap.dispose();
      }
    });

    it("fires removed for clearAll on an existing session", async () => {
      await store.replace(session("a"));
      await settle();

      const cap = capture(provider);
      try {
        await provider.removeAllSessions();
        await settle();

        const removedIds = cap.events.flatMap((e) => e.removed);
        assert.ok(removedIds.includes("a"), `expected 'a' in removed, got ${removedIds.join(",")}`);
      } finally {
        cap.dispose();
      }
    });

    it("does not fire on activation when there's a pre-existing session", async () => {
      const freshSecrets = new FakeSecretStorage();
      await freshSecrets.seed(SESSIONS_SECRET_KEY, JSON.stringify([session("preexisting")]));
      const freshStore = new SessionStore(freshSecrets);
      const freshProvider = new BuildkiteAuthProvider(freshStore);
      const cap = capture(freshProvider);
      try {
        await settle();
        assert.equal(cap.events.length, 0);
      } finally {
        cap.dispose();
        freshProvider.dispose();
        freshStore.dispose();
        freshSecrets.dispose();
      }
    });

    it("fires added when another window stores a session", async () => {
      const cap = capture(provider);
      try {
        await secrets.writeRaw(
          SESSIONS_SECRET_KEY,
          JSON.stringify([session("from-other-window")]),
        );
        await settle();

        const addedIds = cap.events.flatMap((e) => e.added);
        assert.deepEqual(addedIds, ["from-other-window"]);
      } finally {
        cap.dispose();
      }
    });

    it("fires changed when only the access token rotates", async () => {
      await store.replace(session("a", { accessToken: "v1" }));
      await settle();

      const cap = capture(provider);
      try {
        await secrets.writeRaw(
          SESSIONS_SECRET_KEY,
          JSON.stringify([session("a", { accessToken: "v2" })]),
        );
        await settle();

        const changedIds = cap.events.flatMap((e) => e.changed);
        assert.deepEqual(changedIds, ["a"]);
      } finally {
        cap.dispose();
      }
    });
  });

  describe("getSessions", () => {
    it("returns nothing when storage is empty", async () => {
      const sessions = await provider.getSessions(["read_user"]);
      assert.deepEqual(sessions, []);
    });

    it("returns the stored session as-is when not near expiry", async () => {
      const stored = session("a", { expiresAt: Date.now() + 60 * 60 * 1000 });
      await store.replace(stored);

      const sessions = await provider.getSessions(["read_user"]);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, "a");
      assert.equal(sessions[0].accessToken, stored.accessToken);
    });

    it("returns the session even when scopes don't match the request", async () => {
      const stored = session("a", { scopes: ["read_pipelines"] });
      await store.replace(stored);

      const sessions = await provider.getSessions(["read_secrets_details"]);
      assert.equal(sessions.length, 1);
    });
  });

  describe("removeAllSessions", () => {
    it("returns 0 when there's nothing to remove", async () => {
      assert.equal(await provider.removeAllSessions(), 0);
    });

    it("returns the count and clears storage", async () => {
      await store.replace(session("a"));
      const count = await provider.removeAllSessions();
      assert.equal(count, 1);
      assert.deepEqual(await store.getAll(), []);
    });
  });

  describe("removeSession", () => {
    it("removes the matching session and fires removed", async () => {
      await store.replace(session("a"));
      await settle();

      const cap = capture(provider);
      try {
        await provider.removeSession("a");
        await settle();
        const removedIds = cap.events.flatMap((e) => e.removed);
        assert.ok(removedIds.includes("a"));
      } finally {
        cap.dispose();
      }
    });

    it("is a noop for an unknown id", async () => {
      const cap = capture(provider);
      try {
        await provider.removeSession("nope");
        await settle();
        assert.equal(cap.events.length, 0);
      } finally {
        cap.dispose();
      }
    });
  });

  describe("refreshWithRetry (CAS path)", () => {
    let originalFetch: typeof global.fetch;
    let fetchCalls: number;
    let fetchHandler: () => Response | Promise<Response>;

    beforeEach(() => {
      originalFetch = global.fetch;
      fetchCalls = 0;
      fetchHandler = () =>
        new Response(JSON.stringify({ access_token: "new", refresh_token: "new-rt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      global.fetch = async () => {
        fetchCalls += 1;
        return fetchHandler();
      };
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("rotates the stored refresh token on success", async () => {
      const old = session("a", {
        refreshToken: "rt-old",
        expiresAt: Date.now() - 1000,
      });
      await store.replace(old);

      const sessions = await provider.getSessions(["read_user"]);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].accessToken, "new");

      const after = await store.getById("a");
      assert.equal(after?.refreshToken, "new-rt");
    });

    it("when the server says invalid_grant, the session is removed", async () => {
      fetchHandler = () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });

      const old = session("a", {
        refreshToken: "dead",
        expiresAt: Date.now() - 1000,
      });
      await store.replace(old);

      const sessions = await provider.getSessions(["read_user"]);
      assert.equal(sessions.length, 0);
      assert.equal(await store.getById("a"), undefined);
    });

    it("does not remove when another window already rotated forward", async () => {
      fetchHandler = () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });

      await store.replace(session("a", { refreshToken: "rt-rotated", expiresAt: Date.now() + 60_000 }));
      const stale = session("a", { refreshToken: "rt-old", expiresAt: Date.now() - 1000 });

      const result = await (provider as unknown as {
        refreshWithRetry(s: StoredSession): Promise<StoredSession | undefined>;
      }).refreshWithRetry(stale);

      assert.equal(result?.refreshToken, "rt-rotated");
      const after = await store.getById("a");
      assert.equal(after?.refreshToken, "rt-rotated");
    });

    it("hands back the existing token when refresh fails transiently", async () => {
      fetchHandler = () => new Response("bad gateway", { status: 502 });

      const stillValid = session("a", {
        accessToken: "stillvalid",
        expiresAt: Date.now() + REFRESH_LEEWAY_MS + 30_000,
      });
      await store.replace(stillValid);

      const result = await (provider as unknown as {
        refreshWithRetry(s: StoredSession): Promise<StoredSession | undefined>;
      }).refreshWithRetry(stillValid);

      assert.equal(result?.accessToken, "stillvalid");
      assert.equal(fetchCalls, 2);
    });
  });
});

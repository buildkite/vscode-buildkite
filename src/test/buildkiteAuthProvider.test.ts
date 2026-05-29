import * as assert from "node:assert/strict";
import * as http from "node:http";
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
  const scopes = overrides.scopes ?? ["read_user"];
  return {
    id,
    accessToken: `at-${id}`,
    refreshToken: `rt-${id}`,
    expiresAt: Date.now() + 60_000,
    scopes,
    // default to whatever scopes is, tests that care about role narrowing
    // set requestedScopes explicitly to be wider than scopes
    requestedScopes: scopes,
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

    it("filters out a session whose granted scopes don't cover the request", async () => {
      const stored = session("a", {
        scopes: ["read_pipelines"],
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      await store.replace(stored);

      const sessions = await provider.getSessions(["read_secrets_details"]);
      assert.equal(sessions.length, 0);
    });

    it("returns a session whose granted scopes are a superset of the request", async () => {
      const stored = session("a", {
        scopes: ["read_user", "read_pipelines", "write_pipelines"],
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      await store.replace(stored);

      const sessions = await provider.getSessions(["read_pipelines"]);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, "a");
    });

    it("returns a session when granted scopes are narrower than asked-for, as long as the original ask covers the request", async () => {
      // role-limited user, asked for [read_user, write_secrets] at sign in,
      // server granted only [read_user] because the user's role doesn't permit
      // write_secrets, next getSessions for the same ask should still surface
      // the session rather than loop the user back through sign in
      const stored = session("a", {
        scopes: ["read_user"],
        requestedScopes: ["read_user", "write_secrets"],
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      await store.replace(stored);

      const sessions = await provider.getSessions(["read_user", "write_secrets"]);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, "a");
      // the public scopes field reflects what was actually granted, not what
      // was asked for, so callers can inspect what they really got
      assert.deepEqual(sessions[0].scopes, ["read_user"]);
    });

    it("returns every stored session when no scopes are requested", async () => {
      const a = session("a", { expiresAt: Date.now() + 60 * 60 * 1000 });
      const b = session("b", {
        scopes: ["read_pipelines"],
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      await store.replace(a);
      await secrets.writeRaw(SESSIONS_SECRET_KEY, JSON.stringify([a, b]));

      const sessions = await provider.getSessions();
      assert.equal(sessions.length, 2);
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

    it("shares one fetch across concurrent refreshes via refreshesInFlight", async () => {
      const expired = session("a", {
        refreshToken: "rt-old",
        expiresAt: Date.now() - 1000,
      });
      await store.replace(expired);

      const [first, second, third] = await Promise.all([
        provider.getSessions(["read_user"]),
        provider.getSessions(["read_user"]),
        provider.getSessions(["read_user"]),
      ]);

      assert.equal(first.length, 1);
      assert.equal(second.length, 1);
      assert.equal(third.length, 1);
      assert.equal(fetchCalls, 1);
    });
  });

  describe("disposal", () => {
    it("ignores recompute callbacks scheduled after dispose", async () => {
      let fired = 0;
      const sub = provider.onDidChangeSessions(() => {
        fired += 1;
      });

      provider.dispose();
      await secrets.writeRaw(
        SESSIONS_SECRET_KEY,
        JSON.stringify([session("post-dispose")]),
      );
      await settle();

      assert.equal(fired, 0);
      sub.dispose();
    });

    it("dispose is idempotent", () => {
      provider.dispose();
      provider.dispose();
    });

    it("recovers silently when the initial seed read throws", async () => {
      const throwingSecrets = new FakeSecretStorage();
      throwingSecrets.get = async () => {
        throw new Error("storage corrupted");
      };
      const throwingStore = new SessionStore(throwingSecrets);

      let constructorThrew = false;
      let errorProvider: BuildkiteAuthProvider | undefined;
      try {
        errorProvider = new BuildkiteAuthProvider(throwingStore);
        await settle();
      } catch {
        constructorThrew = true;
      } finally {
        errorProvider?.dispose();
        throwingStore.dispose();
        throwingSecrets.dispose();
      }

      assert.equal(constructorThrew, false, "constructor + seed must not throw");
    });
  });

  describe("missing scope warning memoization", () => {
    function warnings(p: BuildkiteAuthProvider): Map<string, Set<string>> {
      return (p as unknown as { missingScopeWarnings: Map<string, Set<string>> })
        .missingScopeWarnings;
    }

    function freshSession(id: string, scopes: string[]): StoredSession {
      return session(id, { scopes, expiresAt: Date.now() + 60 * 60 * 1000 });
    }

    it("records each missing scope only once per session id", async () => {
      await store.replace(freshSession("a", ["read_user"]));
      await settle();

      await provider.getSessions(["read_pipelines"]);
      await provider.getSessions(["read_pipelines"]);
      await provider.getSessions(["read_pipelines"]);

      assert.deepEqual([...(warnings(provider).get("a") ?? [])], ["read_pipelines"]);
    });

    it("adds entries when a new missing scope appears", async () => {
      await store.replace(freshSession("a", ["read_user"]));
      await settle();

      await provider.getSessions(["read_pipelines"]);
      await provider.getSessions(["read_builds"]);

      assert.deepEqual(
        [...(warnings(provider).get("a") ?? [])].sort(),
        ["read_builds", "read_pipelines"],
      );
    });

    it("forgets warnings when the session is removed", async () => {
      await store.replace(freshSession("a", ["read_user"]));
      await settle();

      await provider.getSessions(["read_pipelines"]);
      assert.equal(warnings(provider).get("a")?.size, 1);

      await provider.removeAllSessions();
      await settle();

      assert.equal(warnings(provider).has("a"), false);
    });
  });

  describe("createSession (happy path)", () => {
    type AnyFn = (...args: unknown[]) => unknown;
    const stubs: { restore: () => void }[] = [];

    function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
      const original = target[key];
      target[key] = value;
      stubs.push({ restore: () => { target[key] = original; } });
    }

    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      while (stubs.length) {
        stubs.pop()!.restore();
      }
      global.fetch = originalFetch;
    });

    it("completes the loopback flow and stores a session", async () => {
      stub(vscode.env as unknown as Record<string, AnyFn>, "openExternal", (async (uri: vscode.Uri) => {
        const params = new URLSearchParams(uri.query);
        const redirectUri = params.get("redirect_uri");
        const state = params.get("state");
        if (!redirectUri || !state) {
          throw new Error(`authorize URL missing redirect_uri or state, query=${uri.query}`);
        }
        const target = new URL(redirectUri);
        target.searchParams.set("code", "the-code");
        target.searchParams.set("state", state);
        await new Promise<void>((resolve, reject) => {
          const req = http.request({
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: "GET",
          }, (res) => {
            res.resume();
            res.on("end", () => resolve());
          });
          req.on("error", reject);
          req.end();
        });
        return true;
      }) as unknown as AnyFn);

      stub(vscode.window as unknown as Record<string, AnyFn>, "withProgress",
        (async (_opts: unknown, task: (progress: unknown, token: vscode.CancellationToken) => Promise<unknown>) => {
          const cts = new vscode.CancellationTokenSource();
          try {
            return await task({}, cts.token);
          } finally {
            cts.dispose();
          }
        }) as unknown as AnyFn);

      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            scope: "read_user",
            token_type: "Bearer",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/user")) {
          return new Response(JSON.stringify({
            id: "user-42",
            name: "Ada Lovelace",
            email: "ada@example.com",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`Unexpected fetch ${url}`);
      };

      const cap = capture(provider);
      try {
        const result = await provider.createSession(["read_user"]);
        await settle();

        assert.equal(result.accessToken, "fresh-access");
        assert.equal(result.account.label, "Ada Lovelace");
        assert.equal(result.account.id, "user-42");

        const stored = await store.getAll();
        assert.equal(stored.length, 1);
        assert.equal(stored[0].refreshToken, "fresh-refresh");

        const addedIds = cap.events.flatMap((e) => e.added);
        assert.ok(addedIds.length >= 1, `expected at least one added event, got ${cap.events.length}`);
      } finally {
        cap.dispose();
      }
    });

    it("does not collapse concurrent calls with different scope sets", async () => {
      let openExternalCalls = 0;

      stub(vscode.env as unknown as Record<string, AnyFn>, "openExternal", (async (uri: vscode.Uri) => {
        openExternalCalls += 1;
        const params = new URLSearchParams(uri.query);
        const redirectUri = params.get("redirect_uri")!;
        const state = params.get("state")!;
        const target = new URL(redirectUri);
        target.searchParams.set("code", `code-${openExternalCalls}`);
        target.searchParams.set("state", state);
        await new Promise<void>((resolve, reject) => {
          const req = http.request({
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: "GET",
          }, (res) => {
            res.resume();
            res.on("end", () => resolve());
          });
          req.on("error", reject);
          req.end();
        });
        return true;
      }) as unknown as AnyFn);

      stub(vscode.window as unknown as Record<string, AnyFn>, "withProgress",
        (async (_opts: unknown, task: (progress: unknown, token: vscode.CancellationToken) => Promise<unknown>) => {
          const cts = new vscode.CancellationTokenSource();
          try {
            return await task({}, cts.token);
          } finally {
            cts.dispose();
          }
        }) as unknown as AnyFn);

      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            scope: "read_user",
            token_type: "Bearer",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/user")) {
          return new Response(JSON.stringify({ id: "u", name: "U", email: "u@x" }),
            { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`Unexpected fetch ${url}`);
      };

      await Promise.all([
        provider.createSession(["read_user"]),
        provider.createSession(["read_pipelines"]),
      ]);

      assert.equal(openExternalCalls, 2, "different scope sets must not share a sign-in flow");
    });

    it("collapses concurrent calls so we don't open two browser tabs", async () => {
      let openExternalCalls = 0;
      let tokenExchangeCalls = 0;

      stub(vscode.env as unknown as Record<string, AnyFn>, "openExternal", (async (uri: vscode.Uri) => {
        openExternalCalls += 1;
        const params = new URLSearchParams(uri.query);
        const redirectUri = params.get("redirect_uri")!;
        const state = params.get("state")!;
        const target = new URL(redirectUri);
        target.searchParams.set("code", "the-code");
        target.searchParams.set("state", state);
        await new Promise<void>((resolve, reject) => {
          const req = http.request({
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: "GET",
          }, (res) => {
            res.resume();
            res.on("end", () => resolve());
          });
          req.on("error", reject);
          req.end();
        });
        return true;
      }) as unknown as AnyFn);

      stub(vscode.window as unknown as Record<string, AnyFn>, "withProgress",
        (async (_opts: unknown, task: (progress: unknown, token: vscode.CancellationToken) => Promise<unknown>) => {
          const cts = new vscode.CancellationTokenSource();
          try {
            return await task({}, cts.token);
          } finally {
            cts.dispose();
          }
        }) as unknown as AnyFn);

      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/oauth/token")) {
          tokenExchangeCalls += 1;
          return new Response(JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            scope: "read_user",
            token_type: "Bearer",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/user")) {
          return new Response(JSON.stringify({ id: "user-42", name: "Ada", email: "a@x" }),
            { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`Unexpected fetch ${url}`);
      };

      const [a, b, c] = await Promise.all([
        provider.createSession(["read_user"]),
        provider.createSession(["read_user"]),
        provider.createSession(["read_user"]),
      ]);

      assert.equal(a.accessToken, "fresh-access");
      assert.equal(b.accessToken, "fresh-access");
      assert.equal(c.accessToken, "fresh-access");
      assert.equal(openExternalCalls, 1, "should only open the browser once");
      assert.equal(tokenExchangeCalls, 1, "should only exchange the code once");
      assert.equal((await store.getAll()).length, 1);
    });
  });

  describe("recomputeAndFire diff", () => {
    it("fires changed when the server narrows scopes on refresh", async () => {
      const before = session("a", { accessToken: "v1", scopes: ["read_user", "read_pipelines"] });
      await store.replace(before);
      await settle();

      const cap = capture(provider);
      try {
        // same accessToken, narrower scopes (e.g., server stripped a scope on refresh)
        await secrets.writeRaw(
          SESSIONS_SECRET_KEY,
          JSON.stringify([session("a", { accessToken: "v1", scopes: ["read_user"] })]),
        );
        await settle();

        const changedIds = cap.events.flatMap((e) => e.changed);
        assert.deepEqual(changedIds, ["a"]);
      } finally {
        cap.dispose();
      }
    });

    it("does not fire when only refresh token rotates", async () => {
      // refreshToken and expiresAt aren't in the public AuthenticationSession
      // shape, no point firing CHANGED for them
      const before = session("a", { accessToken: "v1", refreshToken: "rt1" });
      await store.replace(before);
      await settle();

      const cap = capture(provider);
      try {
        await secrets.writeRaw(
          SESSIONS_SECRET_KEY,
          JSON.stringify([session("a", { accessToken: "v1", refreshToken: "rt2" })]),
        );
        await settle();

        const changedIds = cap.events.flatMap((e) => e.changed);
        assert.deepEqual(changedIds, []);
      } finally {
        cap.dispose();
      }
    });
  });
});

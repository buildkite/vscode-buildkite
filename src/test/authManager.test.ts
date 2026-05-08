import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { AuthManager, OAuthProvider } from "../api/auth";
import { AUTH_PROVIDER_ID } from "../api/oauth/constants";

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
  dispose(): void {
    this.emitter.dispose();
  }
}

class FakeOAuthProvider implements OAuthProvider {
  removed: string[] = [];
  async removeSession(id: string): Promise<void> {
    this.removed.push(id);
  }
}

type AnyFn = (...args: unknown[]) => unknown;

const originals: Record<string, AnyFn> = {};

function stubAuth(getSession: (...args: unknown[]) => Promise<unknown>): void {
  (vscode.authentication as unknown as Record<string, AnyFn>).getSession = getSession as AnyFn;
}

function stubInfo(impl: (...args: unknown[]) => Promise<unknown>): void {
  (vscode.window as unknown as Record<string, AnyFn>).showInformationMessage = impl as AnyFn;
}

function stubError(impl: (...args: unknown[]) => Promise<unknown>): void {
  (vscode.window as unknown as Record<string, AnyFn>).showErrorMessage = impl as AnyFn;
}

function stubInputBox(impl: (...args: unknown[]) => Promise<unknown>): void {
  (vscode.window as unknown as Record<string, AnyFn>).showInputBox = impl as AnyFn;
}

function captureOriginals(): void {
  originals.getSession = (vscode.authentication.getSession as unknown as AnyFn).bind(vscode.authentication);
  originals.showInformationMessage = (vscode.window.showInformationMessage as unknown as AnyFn).bind(vscode.window);
  originals.showErrorMessage = (vscode.window.showErrorMessage as unknown as AnyFn).bind(vscode.window);
  originals.showInputBox = (vscode.window.showInputBox as unknown as AnyFn).bind(vscode.window);
}

function restoreOriginals(): void {
  (vscode.authentication as unknown as Record<string, AnyFn>).getSession = originals.getSession;
  (vscode.window as unknown as Record<string, AnyFn>).showInformationMessage = originals.showInformationMessage;
  (vscode.window as unknown as Record<string, AnyFn>).showErrorMessage = originals.showErrorMessage;
  (vscode.window as unknown as Record<string, AnyFn>).showInputBox = originals.showInputBox;
}

describe("AuthManager", () => {
  let secrets: FakeSecretStorage;
  let oauthProvider: FakeOAuthProvider;
  let manager: AuthManager;

  before(() => {
    captureOriginals();
  });
  after(() => {
    restoreOriginals();
  });

  beforeEach(() => {
    secrets = new FakeSecretStorage();
    oauthProvider = new FakeOAuthProvider();
    manager = new AuthManager(secrets, oauthProvider);
  });

  afterEach(() => {
    manager.dispose();
    secrets.dispose();
    restoreOriginals();
  });

  describe("resolveSession", () => {
    it("returns undefined when no OAuth session and no PAT", async () => {
      stubAuth(async () => undefined);
      assert.equal(await manager.resolveSession(), undefined);
    });

    it("returns the OAuth session when one exists", async () => {
      stubAuth(async (provider) => {
        if (provider !== AUTH_PROVIDER_ID) {
          return undefined;
        }
        return {
          id: "s1",
          accessToken: "oauth-token",
          account: { id: "u1", label: "User" },
          scopes: ["read_user"],
        } as vscode.AuthenticationSession;
      });

      const s = await manager.resolveSession();
      assert.equal(s?.token, "oauth-token");
    });

    it("falls back to PAT when no OAuth session", async () => {
      stubAuth(async () => undefined);
      await manager.setToken("pat-secret");

      const s = await manager.resolveSession();
      assert.equal(s?.token, "pat-secret");
    });
  });

  describe("requireSession", () => {
    it("collapses concurrent calls for the same scope set into one prompt", async () => {
      stubAuth(async () => undefined);
      let prompts = 0;
      stubInfo(async () => {
        prompts += 1;
        return undefined;
      });

      const [a, b] = await Promise.all([
        manager.requireSession(),
        manager.requireSession(),
      ]);

      assert.equal(prompts, 1);
      assert.equal(a, undefined);
      assert.equal(b, undefined);
    });
  });

  describe("setToken / clearToken / hasStoredPat", () => {
    it("setToken fires onDidChangeCredential", async () => {
      let fired = 0;
      manager.onDidChangeCredential(() => {
        fired += 1;
      });

      await manager.setToken("x");
      assert.equal(fired, 1);
      assert.equal(await manager.hasStoredPat(), true);
    });

    it("clearToken fires onDidChangeCredential and removes the PAT", async () => {
      await manager.setToken("x");
      let fired = 0;
      manager.onDidChangeCredential(() => {
        fired += 1;
      });

      await manager.clearToken();
      assert.equal(fired, 1);
      assert.equal(await manager.hasStoredPat(), false);
    });

    it("notifyCredentialChanged fires the event without touching storage", async () => {
      let fired = 0;
      manager.onDidChangeCredential(() => {
        fired += 1;
      });

      manager.notifyCredentialChanged();
      assert.equal(fired, 1);
    });
  });

  describe("handleUnauthorized (via AuthSession.invalidate)", () => {
    it("PAT 401 calls the recovery prompt once even with concurrent invalidates", async () => {
      stubAuth(async () => undefined);
      await manager.setToken("dead-pat");

      let prompts = 0;
      stubError(async () => {
        prompts += 1;
        return undefined;
      });

      const session = await manager.resolveSession();
      assert.ok(session);

      await Promise.all([session.invalidate(), session.invalidate(), session.invalidate()]);

      assert.equal(prompts, 1);
    });

    it("OAuth 401 routes through the OAuth recovery branch and removes the session", async () => {
      stubAuth(async () => {
        return {
          id: "s1",
          accessToken: "tok",
          account: { id: "u1", label: "User" },
          scopes: ["read_user"],
        } as vscode.AuthenticationSession;
      });

      stubError(async () => undefined);

      const session = await manager.resolveSession();
      assert.ok(session);

      await session.invalidate();

      assert.deepEqual(oauthProvider.removed, ["s1"]);
    });

    it("a PAT 401 in flight swallows a concurrent OAuth 401", async () => {
      stubAuth(async () => undefined);
      await manager.setToken("dead-pat");

      let resolveFirst!: () => void;
      let prompts = 0;
      stubError(async () => {
        prompts += 1;
        // hold the PAT prompt open so we can land an OAuth 401 mid-flight
        await new Promise<void>((r) => { resolveFirst = r; });
        return undefined;
      });

      const patSession = await manager.resolveSession();
      assert.ok(patSession);

      const patPromise = patSession.invalidate();

      // simulate an OAuth 401 arriving while the PAT prompt is up
      const oauthSession = {
        token: "oauth-tok",
        invalidate: () =>
          (manager as unknown as {
            handleUnauthorized(source: "oauth" | "pat", id?: string): Promise<void>;
          }).handleUnauthorized("oauth", "s99"),
      };
      const oauthPromise = oauthSession.invalidate();

      resolveFirst();
      await Promise.all([patPromise, oauthPromise]);

      // both 401s share the same prompt, so the OAuth removeSession path
      // never runs while the PAT prompt is in flight
      assert.equal(prompts, 1);
      assert.deepEqual(oauthProvider.removed, []);
    });
  });

  describe("promptForApiToken", () => {
    it("stores what the user types and fires the change event", async () => {
      stubInputBox(async () => "freshly-typed-token");

      let fired = 0;
      manager.onDidChangeCredential(() => {
        fired += 1;
      });

      const result = await manager.promptForApiToken();
      assert.equal(result, "freshly-typed-token");
      assert.equal(fired, 1);
      assert.equal(await manager.hasStoredPat(), true);
    });

    it("returns undefined and does not fire when the user cancels", async () => {
      stubInputBox(async () => undefined);

      let fired = 0;
      manager.onDidChangeCredential(() => {
        fired += 1;
      });

      const result = await manager.promptForApiToken();
      assert.equal(result, undefined);
      assert.equal(fired, 0);
    });
  });
});

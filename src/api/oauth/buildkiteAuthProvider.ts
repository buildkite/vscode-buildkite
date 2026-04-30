import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL, AUTH_TIMEOUT_MS, DEFAULT_CLIENT_ID, DEFAULT_WEB_BASE_URL, REFRESH_LEEWAY_MS } from "./constants";
import { AllScopes } from "./scopes";
import { codeChallengeFromVerifier, generateCodeVerifier, generateState } from "./pkce";
import { startLoopbackServer } from "./loopbackServer";
import { exchangeAuthorizationCode, refreshAccessToken, RefreshTokenInvalidError, TokenResponse } from "./tokenExchange";
import { SessionStore, StoredSession } from "./sessionStore";

export class BuildkiteAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  static readonly id = AUTH_PROVIDER_ID;
  static readonly label = AUTH_PROVIDER_LABEL;

  private readonly onDidChange = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.onDidChange.event;

  private readonly refreshesInFlight = new Map<string, Promise<StoredSession>>();

  constructor(private readonly store: SessionStore) {}

  dispose(): void {
    this.onDidChange.dispose();
  }

  async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const all = await this.store.getAll();
    const matching = scopes && scopes.length > 0
      ? all.filter((s) => scopesMatch(s.scopes, scopes))
      : all;

    const results: vscode.AuthenticationSession[] = [];
    for (const stored of matching) {
      const fresh = await this.ensureFresh(stored);
      if (fresh) {
        results.push(toSession(fresh));
      }
    }
    return results;
  }

  async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    const resolvedScopes = scopes.length > 0 ? [...scopes] : [...AllScopes];

    const clientId = this.config<string>("oauth.clientId") || DEFAULT_CLIENT_ID;
    const webBaseUrl = this.config<string>("webBaseUrl") || DEFAULT_WEB_BASE_URL;

    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);
    const state = generateState();

    const loopback = await startLoopbackServer(state, AUTH_TIMEOUT_MS);

    try {
      const authorizeUrl = buildAuthorizeUrl(webBaseUrl, {
        clientId,
        redirectUri: loopback.redirectUri,
        scopes: resolvedScopes,
        state,
        codeChallenge: challenge,
      });

      const opened = await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));
      if (!opened) {
        throw new Error("Could not open the browser to complete Buildkite sign-in.");
      }

      const { code } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Signing in to Buildkite… complete the authorization in your browser.",
          cancellable: true,
        },
        async (_progress, token) => {
          const cancelSub = token.onCancellationRequested(() => loopback.dispose());
          try {
            return await loopback.waitForCallback();
          } finally {
            cancelSub.dispose();
          }
        },
      );

      const tokens = await exchangeAuthorizationCode({
        clientId,
        code,
        codeVerifier: verifier,
        redirectUri: loopback.redirectUri,
        webBaseUrl,
      });

      if (!tokens.refreshToken) {
        throw new Error("Buildkite did not return a refresh token. Refresh support is required.");
      }

      const account = await fetchAccount(tokens.accessToken);
      const session: StoredSession = {
        id: randomUUID(),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: computeExpiresAt(tokens),
        scopes: grantedScopes(tokens, resolvedScopes),
        account,
      };

      await this.store.upsert(session);
      const vscodeSession = toSession(session);
      this.onDidChange.fire({ added: [vscodeSession], removed: [], changed: [] });
      return vscodeSession;
    } finally {
      loopback.dispose();
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    const removed = await this.store.remove(sessionId);
    if (removed) {
      this.onDidChange.fire({ added: [], removed: [toSession(removed)], changed: [] });
    }
  }

  private async ensureFresh(session: StoredSession): Promise<StoredSession | undefined> {
    if (session.expiresAt - Date.now() > REFRESH_LEEWAY_MS) {
      return session;
    }

    const existing = this.refreshesInFlight.get(session.id);
    if (existing) {
      try {
        return await existing;
      } catch {
        return undefined;
      }
    }

    const clientId = this.config<string>("oauth.clientId") || DEFAULT_CLIENT_ID;
    const webBaseUrl = this.config<string>("webBaseUrl") || DEFAULT_WEB_BASE_URL;

    const promise = (async () => {
      const tokens = await refreshAccessToken({
        clientId,
        webBaseUrl,
        refreshToken: session.refreshToken,
      });
      const refreshed: StoredSession = {
        ...session,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? session.refreshToken,
        expiresAt: computeExpiresAt(tokens),
        scopes: grantedScopes(tokens, session.scopes),
      };
      await this.store.upsert(refreshed);
      return refreshed;
    })();

    this.refreshesInFlight.set(session.id, promise);
    try {
      const refreshed = await promise;
      this.onDidChange.fire({ added: [], removed: [], changed: [toSession(refreshed)] });
      return refreshed;
    } catch (err) {
      if (err instanceof RefreshTokenInvalidError) {
        const removed = await this.store.remove(session.id);
        if (removed) {
          this.onDidChange.fire({ added: [], removed: [toSession(removed)], changed: [] });
        }
        return undefined;
      }
      // Transient error — keep the session so the next call can retry, and surface the existing token in the meantime.
      return session;
    } finally {
      this.refreshesInFlight.delete(session.id);
    }
  }

  private config<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration("buildkite").get<T>(key);
  }
}

function scopesMatch(stored: readonly string[], requested: readonly string[]): boolean {
  if (requested.length === 0) {
    return true;
  }
  return requested.every((s) => stored.includes(s));
}

function toSession(session: StoredSession): vscode.AuthenticationSession {
  return {
    id: session.id,
    accessToken: session.accessToken,
    account: session.account,
    scopes: session.scopes,
  };
}

function computeExpiresAt(tokens: TokenResponse): number {
  const defaultTtlSec = 60 * 60;
  const ttlSec = tokens.expiresIn && tokens.expiresIn > 0 ? tokens.expiresIn : defaultTtlSec;
  return Date.now() + ttlSec * 1000;
}

function grantedScopes(tokens: TokenResponse, fallback: readonly string[]): string[] {
  if (tokens.scope && tokens.scope.trim().length > 0) {
    return tokens.scope.split(/\s+/).filter(Boolean);
  }
  return [...fallback];
}

interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
}

function buildAuthorizeUrl(webBaseUrl: string, input: AuthorizeUrlInput): string {
  const base = webBaseUrl.endsWith("/") ? webBaseUrl.slice(0, -1) : webBaseUrl;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${base}/oauth/authorize?${params.toString()}`;
}

async function fetchAccount(accessToken: string): Promise<StoredSession["account"]> {
  const apiBaseUrl = (
    vscode.workspace.getConfiguration("buildkite").get<string>("apiBaseUrl")?.trim() ||
    "https://api.buildkite.com/v2"
  ).replace(/\/$/, "");
  try {
    const response = await fetch(`${apiBaseUrl}/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (response.ok) {
      const body = (await response.json()) as { id?: string; email?: string; name?: string };
      const id = body.id ?? body.email ?? "buildkite-user";
      const label = body.name ?? body.email ?? "Buildkite User";
      return { id, label };
    }
  } catch {
    // fall through
  }
  return { id: "buildkite-user", label: "Buildkite User" };
}

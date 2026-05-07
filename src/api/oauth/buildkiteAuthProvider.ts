import * as vscode from "vscode";
import { randomUUID } from "crypto";
import {
  AUTH_PROVIDER_ID,
  AUTH_PROVIDER_LABEL,
  ACCOUNT_FETCH_TIMEOUT_MS,
  AUTH_TIMEOUT_MS,
  DEFAULT_CLIENT_ID,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_BASE_URL,
  REFRESH_LEEWAY_MS,
  resolveConfiguredUrl,
  trimTrailingSlash,
} from "./constants";
import { OAuthProvider } from "./types";
import { oauthLog, redactIfCredentialShaped } from "./log";
import { AllScopes } from "./scopes";
import { codeChallengeFromVerifier, generateCodeVerifier, generateState } from "./pkce";
import { startLoopbackServer, LoopbackHandle } from "./loopbackServer";
import { exchangeAuthorizationCode, refreshAccessToken, RefreshTokenInvalidError, TokenResponse } from "./tokenExchange";
import { SessionStore, StoredSession } from "./sessionStore";

const TRANSIENT_REFRESH_RETRY_BASE_MS = 500;
const TRANSIENT_REFRESH_RETRY_JITTER_MS = 250;

export class BuildkiteAuthProvider
  implements vscode.AuthenticationProvider, vscode.Disposable, OAuthProvider
{
  static readonly id = AUTH_PROVIDER_ID;
  static readonly label = AUTH_PROVIDER_LABEL;

  private readonly onDidChange = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.onDidChange.event;

  private readonly refreshesInFlight = new Map<string, Promise<StoredSession | undefined>>();
  private readonly activeLoopbacks = new Set<LoopbackHandle>();
  // Cache of last fired sessions, diffed on each change so echoes from this
  // window's own secrets.onDidChange don't double trigger
  private lastFiredById = new Map<string, StoredSession>();
  private recomputeMutex: Promise<void> = Promise.resolve();
  private readonly storeSubscription: vscode.Disposable;

  constructor(private readonly store: SessionStore) {
    // Pick up sign ins or sign outs from other VS Code windows
    this.storeSubscription = this.store.onExternalChange(() => {
      void this.recomputeAndFire();
    });
    // Snapshot what's already saved so the first event we fire is for a
    // real change, not for sessions that were already there when the
    // extension started up, going through the same mutex as recomputeAndFire
    // so events arriving during activation wait their turn
    this.recomputeMutex = this.recomputeMutex.then(async () => {
      const current = await this.store.getAll();
      this.lastFiredById = new Map(current.map((s) => [s.id, s]));
    }).catch((err) => {
      // Log it, otherwise the next change event treats existing sessions as new
      const detail = err instanceof Error ? err.message : String(err);
      oauthLog(`Failed to seed lastFiredById on activation: ${detail}`);
    });
  }

  dispose(): void {
    // Kill any sign in browser servers still running so closing the
    // window partway through releases the port right away instead of
    // waiting out the 5 minute auth timeout
    for (const handle of this.activeLoopbacks) {
      handle.dispose();
    }
    this.activeLoopbacks.clear();
    this.storeSubscription.dispose();
    this.onDidChange.dispose();
  }

  // Read the current sessions, work out what's added/removed/changed
  // against the last snapshot, and fire one event with the result, locked
  // so two callers don't race the snapshot
  private recomputeAndFire(): Promise<void> {
    this.recomputeMutex = this.recomputeMutex.then(async () => {
      const current = await this.store.getAll();
      const currentById = new Map(current.map((s) => [s.id, s]));
      const added: vscode.AuthenticationSession[] = [];
      const removed: vscode.AuthenticationSession[] = [];
      const changed: vscode.AuthenticationSession[] = [];

      for (const s of current) {
        const prev = this.lastFiredById.get(s.id);
        if (!prev) {
          added.push(toSession(s));
        } else if (prev.accessToken !== s.accessToken) {
          changed.push(toSession(s));
        }
      }
      for (const [id, prev] of this.lastFiredById) {
        if (!currentById.has(id)) {
          removed.push(toSession(prev));
        }
      }

      this.lastFiredById = currentById;
      if (added.length || removed.length || changed.length) {
        this.onDidChange.fire({ added, removed, changed });
      }
    }).catch(() => undefined);
    return this.recomputeMutex;
  }

  async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    // Any stored session is good enough, strict matching would loop
    // forever for users whose role can't grant every scope we ask for
    // since grants are trimmed server side to what the role allows
    //
    // Missing scopes show up as 403s on the endpoint that needs them,
    // which the clients don't treat as sign in failures, so only 401
    // (token revoked) drives a sign in prompt
    //
    // We log when a returned session is missing requested scopes so it
    // shows up in the output channel if we ever care
    const all = await this.store.getAll();
    if (scopes && scopes.length > 0) {
      for (const s of all) {
        const granted = new Set(s.scopes);
        const missing = scopes.filter((scope) => !granted.has(scope));
        if (missing.length > 0) {
          oauthLog(
            `Returning session that lacks requested scopes: missing=[${missing.join(", ")}]; ` +
              `granted=[${s.scopes.join(", ")}]. The user's Buildkite role likely doesn't permit them.`,
          );
        }
      }
    }

    // Refresh in parallel since `refreshesInFlight` already shares one
    // refresh per session, so adding multiple accounts later won't
    // serialise N round trips
    const refreshed = await Promise.all(all.map((s) => this.ensureFresh(s)));
    return refreshed.filter((s): s is StoredSession => s !== undefined).map(toSession);
  }


  async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    const resolvedScopes = scopes.length > 0 ? [...scopes] : [...AllScopes];
    oauthLog(
      `PKCE flow started: scopes=[${resolvedScopes.join(", ")}] (${resolvedScopes.length})`,
    );

    const clientId = this.config<string>("oauth.clientId") || DEFAULT_CLIENT_ID;
    const webBaseUrl = this.config<string>("webBaseUrl") || DEFAULT_WEB_BASE_URL;

    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);
    const state = generateState();

    const loopback = await startLoopbackServer(state, AUTH_TIMEOUT_MS);
    this.activeLoopbacks.add(loopback);

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
      oauthLog(`Sign-in complete: account=${account.label}`);

      const session: StoredSession = {
        id: randomUUID(),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: computeExpiresAt(tokens),
        scopes: grantedScopes(tokens, resolvedScopes),
        account,
      };
      // We only support one account at a time, so swap every prior
      // session in one write to stop a sign in from another window from
      // landing in the gap between read and write
      await this.store.replace(session);
      await this.recomputeAndFire();
      return toSession(session);
    } finally {
      loopback.dispose();
      this.activeLoopbacks.delete(loopback);
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    const removed = await this.store.remove(sessionId);
    if (removed) {
      oauthLog(`Session removed: id=${sessionId}`);
      await this.recomputeAndFire();
    }
  }

  // Oneshot signout, a concurrent createSession in another window can't
  // slip in between snapshot and remove
  //
  // Returns the count so the caller can pick the right toast
  async removeAllSessions(): Promise<number> {
    const removed = await this.store.clearAll();
    if (removed.length > 0) {
      oauthLog(`All sessions removed: count=${removed.length}`);
      await this.recomputeAndFire();
    }
    return removed.length;
  }

  private async ensureFresh(session: StoredSession): Promise<StoredSession | undefined> {
    if (session.expiresAt - Date.now() > REFRESH_LEEWAY_MS) {
      return session;
    }

    const existing = this.refreshesInFlight.get(session.id);
    if (existing) {
      return existing;
    }

    const promise = this.refreshWithRetry(session).finally(() => {
      this.refreshesInFlight.delete(session.id);
    });
    this.refreshesInFlight.set(session.id, promise);
    return promise;
  }

  private async refreshWithRetry(session: StoredSession): Promise<StoredSession | undefined> {
    const clientId = this.config<string>("oauth.clientId") || DEFAULT_CLIENT_ID;
    const webBaseUrl = this.config<string>("webBaseUrl") || DEFAULT_WEB_BASE_URL;

    let current = session;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        oauthLog(`Token refresh attempt ${attempt + 1} for session ${current.id}`);
        const tokens = await refreshAccessToken({
          clientId,
          webBaseUrl,
          refreshToken: current.refreshToken,
          scopes: current.scopes,
        });
        const refreshed: StoredSession = {
          ...current,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? current.refreshToken,
          expiresAt: computeExpiresAt(tokens),
          scopes: grantedScopes(tokens, current.scopes),
        };
        // Compare and swap, if another window rotated the refresh token
        // between our read and write, take its newer session instead of
        // clobbering it
        const wrote = await this.store.swapIfRefreshTokenMatches(
          refreshed,
          current.refreshToken,
        );
        if (!wrote) {
          oauthLog(
            `Token refresh succeeded for session ${current.id} but another window rotated first; deferring`,
          );
          return this.store.getById(current.id);
        }
        oauthLog(`Token refresh succeeded for session ${current.id}`);
        await this.recomputeAndFire();
        return refreshed;
      } catch (err) {
        lastErr = err;
        const detail = err instanceof Error ? err.message : String(err);
        oauthLog(`Token refresh attempt ${attempt + 1} failed: ${redactIfCredentialShaped(detail)}`);
        if (err instanceof RefreshTokenInvalidError) {
          break;
        }
        if (attempt === 0) {
          // Jitter so two windows hitting the same transient failure don't
          // retry in lockstep against the auth server
          const jitter = Math.floor(Math.random() * TRANSIENT_REFRESH_RETRY_JITTER_MS);
          await sleep(TRANSIENT_REFRESH_RETRY_BASE_MS + jitter);
          // Another window may have rotated the refresh_token while we
          // slept, read again so the retry doesn't replay a consumed token
          const latest = await this.store.getById(current.id);
          if (!latest) {
            // Session was removed (e.g. invalid_grant elsewhere), give up
            return undefined;
          }
          current = latest;
        }
      }
    }

    if (lastErr instanceof RefreshTokenInvalidError) {
      // Our refresh token is dead (long live the new one), but another
      // window may have rotated the stored record while we were trying,
      // so read again first and only remove if our (now dead) token is
      // still the one in storage, otherwise hand back the newer session
      // and leave it alone
      const latest = await this.store.getById(session.id);
      if (latest && latest.refreshToken !== current.refreshToken) {
        oauthLog(`Refresh token invalid here, but session ${session.id} was rotated by another window, deferring`);
        return latest;
      }
      oauthLog(`Refresh token invalid, removing session ${session.id}`);
      const removed = await this.store.remove(session.id);
      if (removed) {
        await this.recomputeAndFire();
      }
      return undefined;
    }
    // Transient failure (network blip, 5xx) and the stored access token is
    // still valid for at least REFRESH_LEEWAY_MS, so hand it back instead
    // of making the user think they got signed out
    //
    // If it has actually expired by the time the API call runs, the 401
    // path takes over
    const stillValid = await this.store.getById(session.id);
    if (stillValid && stillValid.expiresAt > Date.now()) {
      oauthLog(
        `Token refresh failed transiently for session ${session.id}; using existing token until next 401`,
      );
      return stillValid;
    }
    return undefined;
  }

  private config<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration("buildkite").get<T>(key);
  }
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
  const ttlSec = tokens.expiresIn && tokens.expiresIn > 0
    ? tokens.expiresIn
    : DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
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
  const base = trimTrailingSlash(webBaseUrl);
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
  const apiBaseUrl = resolveConfiguredUrl(
    vscode.workspace.getConfiguration("buildkite"),
    "apiBaseUrl",
    DEFAULT_API_BASE_URL,
  );

  // Bound the request so a stuck server can't hang sign in past the
  // loopback timeout, which has already fired by the time we reach here
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACCOUNT_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `Buildkite user fetch timed out after ${ACCOUNT_FETCH_TIMEOUT_MS}ms.`,
      );
    }
    // Node's fetch wraps the real reason in `err.cause`. Surface it so
    // "fetch failed" doesn't hide the actual problem (DNS, TLS, etc)
    const message = err instanceof Error ? err.message : String(err);
    const causeErr = (err as { cause?: unknown })?.cause;
    const cause = causeErr instanceof Error ? causeErr.message : "";
    const detail = cause ? `${message} (${cause})` : message;
    oauthLog(`Account fetch network error against ${apiBaseUrl}/user: ${detail}`);
    throw new Error(`Could not load Buildkite user account: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    oauthLog(`Account fetch failed: HTTP ${response.status} (likely missing read_user scope)`);
    throw new Error(
      `Sign-in succeeded but the Buildkite user could not be loaded (HTTP ${response.status}). ` +
        `Make sure your scope preset grants 'read_user'.`,
    );
  }
  if (!response.ok) {
    oauthLog(`Account fetch failed: HTTP ${response.status}`);
    throw new Error(
      `Sign-in succeeded but the Buildkite user could not be loaded (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as { id?: string; email?: string; name?: string };
  // Pin VS Code's account identity to the server's stable numeric `id`,
  // using `email` would silently orphan stored sessions whenever a user
  // changes their email
  //
  // Trade off, if `id` ever goes missing on a future API change we
  // throw here loudly, which beats a silent session loss bug
  const id = body.id;
  const label = body.name ?? body.email ?? body.id;
  if (!id || !label) {
    throw new Error("Buildkite returned an unexpected user payload.");
  }
  oauthLog(`Account loaded: ${label}`);
  return { id, label };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

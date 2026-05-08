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
import { debug, error, info, redactIfCredentialShaped, warn } from "../../log";
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
  private readonly missingScopeWarnings = new Map<string, Set<string>>();
  private disposed = false;
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
    // Grab what's already there so the first event is an actual change,
    // not stuff that was always saved, through the mutex so any events
    // arriving during activation queue behind us
    this.recomputeMutex = this.recomputeMutex.then(async () => {
      const current = await this.store.getAll();
      this.lastFiredById = new Map(current.map((s) => [s.id, s]));
    }).catch((err) => {
      // Log it, otherwise the next change event treats existing sessions as new
      const detail = err instanceof Error ? err.message : String(err);
      error(`[OAuth] Failed to seed lastFiredById on activation: ${detail}`);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // Kill any signin browser servers still running so closing the window
    // partway through releases the port right away instead of waiting out
    // the 5 minute auth timeout
    for (const handle of this.activeLoopbacks) {
      handle.dispose();
    }
    this.activeLoopbacks.clear();
    this.storeSubscription.dispose();
    this.onDidChange.dispose();
  }

  private warnAboutMissingScopesOnce(session: StoredSession, requested: readonly string[]): void {
    const granted = new Set(session.scopes);
    const missing = requested.filter((scope) => !granted.has(scope));
    if (missing.length === 0) {
      return;
    }
    let warned = this.missingScopeWarnings.get(session.id);
    if (!warned) {
      warned = new Set();
      this.missingScopeWarnings.set(session.id, warned);
    }
    const newlyMissing = missing.filter((scope) => !warned.has(scope));
    if (newlyMissing.length === 0) {
      return;
    }
    for (const scope of newlyMissing) {
      warned.add(scope);
    }
    warn(
      `[OAuth] Returning session that lacks requested scopes: missing=[${newlyMissing.join(", ")}]; ` +
        `granted=[${session.scopes.join(", ")}]. The user's Buildkite role likely doesn't permit them.`,
    );
  }

  // Read the current sessions, work out what's added/removed/changed
  // against the last snapshot, and fire one event with the result, locked
  // so two callers don't race the snapshot
  private recomputeAndFire(): Promise<void> {
    this.recomputeMutex = this.recomputeMutex.then(async () => {
      if (this.disposed) {
        return;
      }
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
          this.missingScopeWarnings.delete(id);
        }
      }

      this.lastFiredById = currentById;
      if (this.disposed) {
        return;
      }
      if (added.length || removed.length || changed.length) {
        this.onDidChange.fire({ added, removed, changed });
      }
    }).catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      error(`[OAuth] recomputeAndFire failed: ${detail}`);
    });
    return this.recomputeMutex;
  }

  async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    // Strict matching causes infinite reprompts because the server trims
    // grants to whatever the user's role allows, a session that asked for
    // X but came back with Y never satisfies a check for X
    //
    // Any session is good enough, if a scope is genuinely missing the
    // endpoint 403s and clients don't treat that as a signin failure
    const all = await this.store.getAll();
    if (scopes && scopes.length > 0) {
      for (const s of all) {
        this.warnAboutMissingScopesOnce(s, scopes);
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
    info(
      `[OAuth] PKCE flow started: scopes=[${resolvedScopes.join(", ")}] (${resolvedScopes.length})`,
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
      info(`[OAuth] Sign-in complete: account=${account.label}`);

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
      // landing in the gap between read and write, the listener on
      // secrets.onDidChange picks up this write and fires the event
      await this.store.replace(session);
      return toSession(session);
    } finally {
      loopback.dispose();
      this.activeLoopbacks.delete(loopback);
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    const removed = await this.store.remove(sessionId);
    if (removed) {
      info(`[OAuth] Session removed: id=${sessionId}`);
    }
  }

  // Atomic so a sign-in from another window can't slip between us
  async removeAllSessions(): Promise<number> {
    const removed = await this.store.clearAll();
    if (removed.length > 0) {
      info(`[OAuth] All sessions removed: count=${removed.length}`);
    }
    return removed.length;
  }

  private async ensureFresh(session: StoredSession): Promise<StoredSession | undefined> {
    // System clock jumping forward can dip a healthy token below the leeway
    // and force an early refresh, jumping backward only inflates the gap so
    // it's a no op, either way the 401 path catches the leftover edge cases
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
        debug(`[OAuth] Token refresh attempt ${attempt + 1} for session ${current.id}`);
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
          debug(
            `[OAuth] Token refresh succeeded for session ${current.id} but another window rotated first; deferring`,
          );
          return this.store.getById(current.id);
        }
        info(`[OAuth] Token refresh succeeded for session ${current.id}`);
        return refreshed;
      } catch (err) {
        lastErr = err;
        const detail = err instanceof Error ? err.message : String(err);
        warn(`[OAuth] Token refresh attempt ${attempt + 1} failed: ${redactIfCredentialShaped(detail)}`);
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
      // Our refresh token is dead (long live the new one), another
      // window may have rotated while we were trying, so read again
      // and only remove if our token is still in storage
      const latest = await this.store.getById(session.id);
      if (latest && latest.refreshToken !== current.refreshToken) {
        debug(`[OAuth] Refresh token invalid here, but session ${session.id} was rotated by another window, deferring`);
        return latest;
      }
      warn(`[OAuth] Refresh token invalid, removing session ${session.id}`);
      await this.store.remove(session.id);
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
      warn(
        `[OAuth] Token refresh failed transiently for session ${session.id}; using existing token until next 401`,
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
    warn(`[OAuth] Account fetch network error against ${apiBaseUrl}/user: ${detail}`);
    throw new Error(`Could not load Buildkite user account: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    warn(`[OAuth] Account fetch failed: HTTP ${response.status} (likely missing read_user scope)`);
    throw new Error(
      `Sign-in succeeded but the Buildkite user could not be loaded (HTTP ${response.status}). ` +
        `Make sure your scope preset grants 'read_user'.`,
    );
  }
  if (!response.ok) {
    warn(`[OAuth] Account fetch failed: HTTP ${response.status}`);
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
  info(`[OAuth] Account loaded: ${label}`);
  return { id, label };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

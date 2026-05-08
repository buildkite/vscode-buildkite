import * as vscode from "vscode";
import { AUTH_PROVIDER_ID } from "./oauth/constants";
import { resolveScopesFromConfig } from "./oauth/scopes";
import { debug, error, info, redactIfCredentialShaped, warn } from "../log";
import type { OAuthProvider } from "./oauth/types";

export type { OAuthProvider };

const SECRET_KEY = "buildkite.apiToken";

type TokenSource = "oauth" | "pat";

/** OAuth session or PAT, opaque to callers */
export interface AuthSession {
  readonly token: string;
  /** Tell AuthManager the token got rejected, concurrent calls share one prompt */
  invalidate(): Promise<void>;
}

interface ResolvedToken {
  token: string;
  source: TokenSource;
  sessionId?: string;
}

export class AuthManager implements vscode.Disposable {
  private unauthorizedPromptInFlight: Promise<void> | undefined;
  // keyed by scope set so callers asking for different scopes don't share
  // a prompt that won't satisfy them both
  private readonly requireSessionInFlight = new Map<
    string,
    Promise<ResolvedToken | undefined>
  >();
  private readonly credentialChangedEmitter = new vscode.EventEmitter<void>();

  /** fires on PAT set/clear or OAuth swap */
  readonly onDidChangeCredential = this.credentialChangedEmitter.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly oauthProvider: OAuthProvider,
  ) {}

  dispose(): void {
    this.credentialChangedEmitter.dispose();
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, token);
    this.credentialChangedEmitter.fire();
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    this.credentialChangedEmitter.fire();
  }

  async hasStoredPat(): Promise<boolean> {
    return (await this.secrets.get(SECRET_KEY)) !== undefined;
  }

  /** so the OAuth listener can route through us */
  notifyCredentialChanged(): void {
    this.credentialChangedEmitter.fire();
  }

  async promptForApiToken(): Promise<string | undefined> {
    const token = await vscode.window.showInputBox({
      prompt: "Enter your Buildkite API Token",
      password: true,
      ignoreFocusOut: true,
    });
    if (!token) {
      return undefined;
    }
    await this.setToken(token);
    return token;
  }

  /** active session or undefined, no prompt */
  async resolveSession(): Promise<AuthSession | undefined> {
    const resolved = await this.resolveToken(snapshotScopes());
    return resolved ? this.toSession(resolved) : undefined;
  }

  /** active session, prompting if needed. concurrent callers share one prompt */
  async requireSession(): Promise<AuthSession | undefined> {
    const scopes = snapshotScopes();
    const key = scopeKey(scopes);
    let inFlight = this.requireSessionInFlight.get(key);
    if (!inFlight) {
      inFlight = this.doRequireToken(scopes).finally(() => {
        this.requireSessionInFlight.delete(key);
      });
      this.requireSessionInFlight.set(key, inFlight);
    }
    const resolved = await inFlight;
    return resolved ? this.toSession(resolved) : undefined;
  }

  /** sign in command, browser flow only if no session */
  async signIn(): Promise<void> {
    try {
      const session = await this.createOAuthSession(snapshotScopes());
      if (session) {
        vscode.window.showInformationMessage(
          `Signed in to Buildkite as ${session.account.label}.`,
        );
      }
    } catch (err) {
      if (err instanceof vscode.CancellationError) {
        info("[OAuth] Sign-in cancelled by user");
        return;
      }
      reportSignInFailure(err);
    }
  }

  private toSession(resolved: ResolvedToken): AuthSession {
    return {
      token: resolved.token,
      invalidate: () => this.handleUnauthorized(resolved.source, resolved.sessionId),
    };
  }

  private async resolveToken(scopes: string[]): Promise<ResolvedToken | undefined> {
    const session = await vscode.authentication.getSession(
      AUTH_PROVIDER_ID,
      scopes,
      { silent: true },
    );
    if (session) {
      return { token: session.accessToken, source: "oauth", sessionId: session.id };
    }

    const pat = await this.secrets.get(SECRET_KEY);
    if (pat) {
      return { token: pat, source: "pat" };
    }

    return undefined;
  }

  private async doRequireToken(scopes: string[]): Promise<ResolvedToken | undefined> {
    const existing = await this.resolveToken(scopes);
    if (existing) {
      return existing;
    }

    // no scope widening detection, sign out + back in to apply a wider preset
    const choice = await vscode.window.showInformationMessage(
      "You need to sign in to Buildkite to continue.",
      "Sign In with Browser",
      "Use API Token",
    );

    if (choice === "Sign In with Browser") {
      try {
        const session = await this.createOAuthSession(scopes);
        if (!session) {
          return undefined;
        }
        return { token: session.accessToken, source: "oauth", sessionId: session.id };
      } catch (err) {
        if (err instanceof vscode.CancellationError) {
          info("[OAuth] Sign-in cancelled by user");
          return undefined;
        }
        reportSignInFailure(err);
        return undefined;
      }
    }

    if (choice === "Use API Token") {
      const token = await this.promptForApiToken();
      return token ? { token, source: "pat" } : undefined;
    }

    return undefined;
  }

  private createOAuthSession(scopes: string[]): Thenable<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession(AUTH_PROVIDER_ID, scopes, { createIfNone: true });
  }

  private handleUnauthorized(source: TokenSource, sessionId?: string): Promise<void> {
    // shared across PAT and OAuth on purpose, both paths end up at "sign in
    // again", so if a PAT 401 is in flight when an OAuth 401 lands the
    // second is swallowed
    if (this.unauthorizedPromptInFlight) {
      return this.unauthorizedPromptInFlight;
    }
    warn(`[OAuth] 401 received: source=${source}${sessionId ? ` sessionId=${sessionId}` : ""}`);
    this.unauthorizedPromptInFlight = (async () => {
      try {
        if (source === "pat") {
          await this.promptPatRecovery();
        } else {
          await this.promptOAuthRecovery(sessionId);
        }
      } catch (err) {
        // caller doesn't await us, don't let this escape
        debug(`[OAuth] handleUnauthorized swallowed error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.unauthorizedPromptInFlight = undefined;
      }
    })();
    return this.unauthorizedPromptInFlight;
  }

  private async promptPatRecovery(): Promise<void> {
    const choice = await vscode.window.showErrorMessage(
      "Your Buildkite API token is invalid or has been revoked.",
      "Set Token",
    );
    if (choice === "Set Token") {
      await this.promptForApiToken();
    }
  }

  private async promptOAuthRecovery(sessionId?: string): Promise<void> {
    if (sessionId) {
      try {
        await this.oauthProvider.removeSession(sessionId);
      } catch (err) {
        // swallow, the recovery prompt below still runs
        debug(`[OAuth] removeSession failed during recovery: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const choice = await vscode.window.showErrorMessage(
      "Your Buildkite OAuth session has expired or been revoked. Sign in again to continue.",
      "Sign In Again",
    );
    if (choice !== "Sign In Again") {
      return;
    }

    await this.signIn();
  }
}

/** 401: kick recovery, log redacted body, throw */
export async function throwIfUnauthorized(response: Response, session: AuthSession): Promise<void> {
  if (response.status !== 401) {
    return;
  }
  try {
    const body = (await response.clone().text()).trim();
    if (body) {
      debug(`[OAuth] 401 body: ${redactIfCredentialShaped(body)}`);
    }
  } catch (err) {
    // don't let a stuck body read block recovery
    debug(`[OAuth] 401 body read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  void session.invalidate();
  throw new Error("Authentication required");
}

function reportSignInFailure(err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = redactIfCredentialShaped(raw);
  error(`[OAuth] Sign-in failed: ${safe}`);
  vscode.window.showErrorMessage(`Buildkite sign-in failed: ${safe}`);
}

function scopeKey(scopes: readonly string[]): string {
  return [...scopes].sort().join(" ");
}

// snapshot at call time so a mid-flight config change can't desync ask vs check
function snapshotScopes(): string[] {
  const config = vscode.workspace.getConfiguration("buildkite");
  return resolveScopesFromConfig({
    preset: config.get<string>("oauth.scopePreset"),
    customScopes: config.get<string[]>("oauth.scopes"),
  });
}

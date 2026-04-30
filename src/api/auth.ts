import * as vscode from "vscode";
import { AUTH_PROVIDER_ID } from "./oauth/constants";
import { resolveScopesFromConfig } from "./oauth/scopes";

const SECRET_KEY = "buildkite.apiToken";

let secretStorage: vscode.SecretStorage | undefined;

/**
 * Manages secure storage and retrieval of Buildkite API tokens.
 * Uses VS Code's SecretStorage API to store tokens securely.
 */

export interface OAuthSessionRemover {
  removeSession(sessionId: string): Promise<void>;
}

let oauthProvider: OAuthSessionRemover | undefined;

export type TokenSource = "oauth" | "pat";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
  sessionId?: string;
}

export class AuthManager {
  /**
   * Initializes the AuthManager with the extension context.
   * Must be called before any other AuthManager methods.
   * @param context - The extension context containing secret storage
   */
  private static reauthPromptInFlight = false;

  static initialize(context: vscode.ExtensionContext) {
    secretStorage = context.secrets;
  }

  /**
   * Retrieves the stored Buildkite API token.
   * @returns The API token if stored, undefined otherwise
   * @throws {Error} If AuthManager has not been initialized
   */

  static registerOAuthProvider(provider: OAuthSessionRemover): void {
    oauthProvider = provider;
  }


  static async getToken(): Promise<string | undefined> {
    const resolved = await this.resolveToken();
    return resolved?.token;
  }

  static async resolveToken(): Promise<ResolvedToken | undefined> {
    if (!secretStorage) {
      throw new Error("AuthManager not initialized");
    }

    const session = await vscode.authentication.getSession(
      AUTH_PROVIDER_ID,
      defaultOAuthScopes(),
      { silent: true },
    );
    if (session) {
      return { token: session.accessToken, source: "oauth", sessionId: session.id };
    }

    const pat = await secretStorage.get(SECRET_KEY);
    if (pat) {
      return { token: pat, source: "pat" };
    }

    return undefined;
  }

  /**
   * Stores a Buildkite API token securely.
   * @param token - The API token to store
   * @throws {Error} If AuthManager has not been initialized
   */
  static async setToken(token: string): Promise<void> {
    if (!secretStorage) {
      throw new Error("AuthManager not initialized");
    }
    await secretStorage.store(SECRET_KEY, token);
  }

  /**
   * Removes the stored Buildkite API token.
   * @throws {Error} If AuthManager has not been initialized
   */
  static async clearToken(): Promise<void> {
    if (!secretStorage) {
      throw new Error("AuthManager not initialized");
    }
    await secretStorage.delete(SECRET_KEY);
  }

  /**
   * Retrieves the API token, prompting the user to set it if not found.
   * If no token is stored, shows an error message with a button to set the token.
   * @returns The API token if available, undefined if the user declines to set it
   */
  static async requireToken(): Promise<string | undefined>;
  static async requireToken(opts: { resolved: true }): Promise<ResolvedToken | undefined>;
  static async requireToken(
    opts?: { resolved?: boolean },
  ): Promise<string | ResolvedToken | undefined> {
    const existing = await this.resolveToken();
    if (existing) {
      return opts?.resolved ? existing : existing.token;
    }

    const choice = await vscode.window.showInformationMessage(
      "You need to sign in to Buildkite to continue.",
      "Sign In with Browser",
      "Use API Token",
    );

    if (choice === "Sign In with Browser") {
      try {
        const session = await vscode.authentication.getSession(
          AUTH_PROVIDER_ID,
          defaultOAuthScopes(),
          { createIfNone: true },
        );
        if (!session) {
          return undefined;
        }
        const resolved: ResolvedToken = {
          token: session.accessToken,
          source: "oauth",
          sessionId: session.id,
        };
        return opts?.resolved ? resolved : resolved.token;
      } catch (err) {
        if (err instanceof vscode.CancellationError) {
          return undefined;
        }
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Buildkite sign-in failed: ${message}`);
        return undefined;
      }
    }

    if (choice === "Use API Token") {
      await vscode.commands.executeCommand("buildkite.setToken");
      return opts?.resolved ? this.resolveToken() : this.getToken();
    }

    return undefined;
  }

  static async handleUnauthorized(
    source: TokenSource,
    sessionId?: string,
  ): Promise<string> {
    if (source === "pat") {
      return "Invalid Buildkite API token. Please update your Buildkite API token.";
    }

    const message =
      "Your Buildkite OAuth session has expired or been revoked. Sign in again to continue.";

    if (sessionId && oauthProvider) {
      try {
        await oauthProvider.removeSession(sessionId);
      } catch {
        // This is best effort, we still prompt the user below
      }
    }

    if (!this.reauthPromptInFlight) {
      this.reauthPromptInFlight = true;
      void (async () => {
        try {
          const choice = await vscode.window.showErrorMessage(
            message,
            { modal: false },
            "Sign In Again",
          );
          if (choice === "Sign In Again") {
            try {
              const session = await vscode.authentication.getSession(
                AUTH_PROVIDER_ID,
                defaultOAuthScopes(),
                { createIfNone: true },
              );
              if (session) {
                vscode.window.showInformationMessage(
                  `Signed in to Buildkite as ${session.account.label}.`,
                );
              }
            } catch (err) {
              if (err instanceof vscode.CancellationError) {
                return;
              }
              const detail = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(`Buildkite sign-in failed: ${detail}`);
            }
          }
        } finally {
          this.reauthPromptInFlight = false;
        }
      })();
    }

    return message;
  }
}

function defaultOAuthScopes(): string[] {
  const config = vscode.workspace.getConfiguration("buildkite");
  return resolveScopesFromConfig({
    preset: config.get<string>("oauth.scopePreset"),
    customScopes: config.get<string[]>("oauth.scopes"),
  });
}

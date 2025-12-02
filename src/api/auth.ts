import * as vscode from "vscode";

const SECRET_KEY = "buildkite.apiToken";

let secretStorage: vscode.SecretStorage | undefined;

/**
 * Manages secure storage and retrieval of Buildkite API tokens.
 * Uses VS Code's SecretStorage API to store tokens securely.
 */
export class AuthManager {
  /**
   * Initializes the AuthManager with the extension context.
   * Must be called before any other AuthManager methods.
   * @param context - The extension context containing secret storage
   */
  static initialize(context: vscode.ExtensionContext) {
    secretStorage = context.secrets;
  }

  /**
   * Retrieves the stored Buildkite API token.
   * @returns The API token if stored, undefined otherwise
   * @throws {Error} If AuthManager has not been initialized
   */
  static async getToken(): Promise<string | undefined> {
    if (!secretStorage) {
      throw new Error("AuthManager not initialized");
    }
    return secretStorage.get(SECRET_KEY);
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
  static async requireToken(): Promise<string | undefined> {
    const token = await this.getToken();
    if (!token) {
      const result = await vscode.window.showErrorMessage(
        "Buildkite API Token is required.",
        "Set Token",
      );
      if (result === "Set Token") {
        vscode.commands.executeCommand("buildkite.setToken");
      }
      return undefined;
    }
    return token;
  }
}

/**
 * Narrow surface BuildkiteAuthProvider exposes to AuthManager. AuthManager
 * uses this to sign out and clean up sessions without reaching into the
 * full vscode.AuthenticationProvider surface or any provider internals.
 */
export interface OAuthProvider {
  /** Remove a specific stored session, no-op if it's already gone. */
  removeSession(sessionId: string): Promise<void>;
  /** Remove every stored session, returns the count removed. */
  removeAllSessions(): Promise<number>;
}

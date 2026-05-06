export interface OAuthProvider {
  removeSession(sessionId: string): Promise<void>;
}

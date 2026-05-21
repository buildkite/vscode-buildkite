import * as vscode from "vscode";
import { DEFAULT_CLIENT_ID, DEFAULT_WEB_BASE_URL, trimTrailingSlash } from "./constants";

export interface OAuthConfig {
  clientId: string;
  webBaseUrl: string;
}

export function getOAuthConfig(): OAuthConfig {
  const c = vscode.workspace.getConfiguration("buildkite");
  const clientId = c.get<string>("oauth.clientId") || DEFAULT_CLIENT_ID;
  const rawBase = c.get<string>("webBaseUrl");
  const webBaseUrl = trimTrailingSlash(
    rawBase && rawBase.trim() ? rawBase.trim() : DEFAULT_WEB_BASE_URL,
  );
  return { clientId, webBaseUrl };
}

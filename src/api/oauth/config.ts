import * as vscode from "vscode";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_CLIENT_ID,
  DEFAULT_WEB_BASE_URL,
  resolveConfiguredUrl,
  trimTrailingSlash,
} from "./constants";

export interface OAuthConfig {
  clientId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
}

export function getOAuthConfig(): OAuthConfig {
  const c = vscode.workspace.getConfiguration("buildkite");
  const rawClientId = c.get<string>("oauth.clientId")?.trim();
  const clientId = rawClientId || DEFAULT_CLIENT_ID;
  const rawBase = c.get<string>("webBaseUrl");
  const webBaseUrl = trimTrailingSlash(
    rawBase && rawBase.trim() ? rawBase.trim() : DEFAULT_WEB_BASE_URL,
  );
  const apiBaseUrl = resolveConfiguredUrl(c, "apiBaseUrl", DEFAULT_API_BASE_URL);
  return { clientId, webBaseUrl, apiBaseUrl };
}

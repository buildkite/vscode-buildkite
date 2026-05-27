export const DEFAULT_CLIENT_ID = "85bcd1d92d30dcb5e074";
export const DEFAULT_WEB_BASE_URL = "https://buildkite.com";
export const DEFAULT_API_BASE_URL = "https://api.buildkite.com/v2";

// Refresh access tokens this far before expiry to absorb clock skew
// and request latency
export const REFRESH_LEEWAY_MS = 60_000;

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const AUTH_TIMEOUT_MS = 5 * 60_000;
export const ACCOUNT_FETCH_TIMEOUT_MS = 15_000;

export const SESSIONS_SECRET_KEY = "buildkite.oauth.sessions";
export const AUTH_PROVIDER_ID = "buildkite";
export const AUTH_PROVIDER_LABEL = "Buildkite";

export function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function resolveConfiguredUrl(
  config: { get<T>(key: string): T | undefined },
  key: string,
  fallback: string,
): string {
  const configured = config.get<string>(key);
  const raw = configured && configured.trim() ? configured.trim() : fallback;
  return trimTrailingSlash(raw);
}

export const DEFAULT_WEB_BASE_URL = "https://buildkite.com";
export const DEFAULT_API_BASE_URL = "https://api.buildkite.com/v2";
export const DEFAULT_GRAPHQL_URL = "https://graphql.buildkite.com/v1";

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

import { warn } from "../log";

export const DEFAULT_WEB_BASE_URL = "https://buildkite.com";
export const DEFAULT_API_BASE_URL = "https://api.buildkite.com/v2";

export function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// https only, except plain http to loopback hosts for local development.
// Anything else (http to a real host, file:, garbage) is rejected so a
// mistyped or maliciously synced setting can't downgrade or redirect the
// bearer token / refresh token.
export function isAllowedBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function resolveConfiguredUrl(
  config: { get<T>(key: string): T | undefined },
  key: string,
  fallback: string,
): string {
  const configured = config.get<string>(key);
  const raw = configured && configured.trim() ? configured.trim() : fallback;
  if (raw !== fallback && !isAllowedBaseUrl(raw)) {
    warn(
      `[Config] Ignoring buildkite.${key}: must be an https URL (http is only allowed for localhost). Using default ${fallback}`,
    );
    return trimTrailingSlash(fallback);
  }
  return trimTrailingSlash(raw);
}

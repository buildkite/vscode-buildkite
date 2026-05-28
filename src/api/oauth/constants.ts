export const DEFAULT_CLIENT_ID = "85bcd1d92d30dcb5e074";

// Refresh access tokens this far before expiry to absorb clock skew
// and request latency
export const REFRESH_LEEWAY_MS = 60_000;

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const AUTH_TIMEOUT_MS = 5 * 60_000;
export const ACCOUNT_FETCH_TIMEOUT_MS = 15_000;

export const SESSIONS_SECRET_KEY = "buildkite.oauth.sessions";
export const AUTH_PROVIDER_ID = "buildkite";
export const AUTH_PROVIDER_LABEL = "Buildkite";

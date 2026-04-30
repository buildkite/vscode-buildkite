/**
 * OAuth-related constants for the Buildkite extension.
 */

/** The default OAuth client ID registered with Buildkite for this extension. */
export const DEFAULT_CLIENT_ID = "buildkite-vscode";

/** The default web base URL where OAuth authorize/token endpoints live. */
export const DEFAULT_WEB_BASE_URL = "https://buildkite.com";

/**
 * How close to `expiresAt` we consider an access token expired and eagerly
 * refresh it. Guards against clock skew and in-flight request latency.
 */
export const REFRESH_LEEWAY_MS = 60_000;

/** How long to wait for the user to complete the browser-based authorization. */
export const AUTH_TIMEOUT_MS = 5 * 60_000;

/** Secret storage key where OAuth sessions are persisted (as JSON array). */
export const SESSIONS_SECRET_KEY = "buildkite.oauth.sessions";

/** The VS Code AuthenticationProvider id for this extension. */
export const AUTH_PROVIDER_ID = "buildkite";

/** Human-readable label shown in the Accounts menu. */
export const AUTH_PROVIDER_LABEL = "Buildkite";

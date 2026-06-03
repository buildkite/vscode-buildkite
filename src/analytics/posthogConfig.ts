// Overridden at build time by scripts/generate-analytics-config.ts
// In CI, POSTHOG_API_KEY env var is set before tsc runs so the generated file bakes in the real key.
// For local dev / open-source builds, tracking is disabled (empty key → client never initialised).
export const POSTHOG_API_KEY = "";

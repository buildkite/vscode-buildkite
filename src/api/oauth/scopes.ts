import { warn } from "../../log";

export const AllScopes: readonly string[] = [
  "read_agents",
  "write_agents",
  "read_artifacts",
  "write_artifacts",
  "read_build_logs",
  "write_build_logs",
  "read_builds",
  "write_builds",
  "read_clusters",
  "write_clusters",
  "read_events",
  "read_job_env",
  "read_pipeline_templates",
  "write_pipeline_templates",
  "read_pipelines",
  "write_pipelines",
  "read_rules",
  "write_rules",

  // Organization and Users
  "read_organizations",
  "read_teams",
  "write_teams",
  "read_user",

  // Security
  "read_secrets_details",
  "write_secrets",

  // Test Engine
  "read_suites",
  "write_suites",
  "read_test_plan",
  "write_test_plan",

  // Packages
  "read_packages",
  "write_packages",
  "delete_packages",
  "read_registries",
  "write_registries",
  "delete_registries",

  // Portals
  "read_portals",
  "write_portals",
];

/** Subset of {@link AllScopes} granting read-only access */
export const ReadOnlyScopes: readonly string[] = AllScopes.filter((s) =>
  s.startsWith("read_"),
);

export function resolveScopesFromConfig(config: {
  preset?: string | undefined;
  customScopes?: readonly string[] | undefined;
}): string[] {
  switch (config.preset) {
    case "read-only":
      return [...ReadOnlyScopes];
    case "custom": {
      // the package.json enum blocks unknown values in the settings UI but
      // settings.json edited directly bypasses that, so drop typos here too
      // and surface them in the log
      const known = new Set<string>(AllScopes);
      const requested = normalize(config.customScopes ?? []);
      const valid = requested.filter((s) => known.has(s));
      const dropped = requested.filter((s) => !known.has(s));
      if (dropped.length > 0) {
        warn(`[OAuth] Ignoring unknown scopes in buildkite.oauth.scopes: [${dropped.join(", ")}]`);
      }
      // empty list silently widening to AllScopes is a footgun, fall back to
      // the bare minimum we need to look up the user
      return valid.length > 0 ? valid : ["read_user"];
    }
    case "all":
    default:
      return [...AllScopes];
  }
}

// Scope IDs are lowercase snake_case, so normalize user input so a typo
// like "Read_user" reaches the server as "read_user" instead of being
// silently rejected
function normalize(scopes: readonly string[]): string[] {
  const out = scopes
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return [...new Set(out)];
}

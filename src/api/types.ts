/**
 * Buildkite API type definitions
 */


export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Pull request information attached to a build
export interface PullRequest {
  id: string;
  base: string;
  repository: string;
}

export interface Pipeline {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  name: string;
  slug: string;
  repository: string;
  description: string | null;
  default_branch: string;
  created_at: string;
  scheduled_builds_count: number;
  running_builds_count: number;
  scheduled_jobs_count: number;
  running_jobs_count: number;
  waiting_jobs_count: number;
}

export interface Build {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  number: number;
  state: BuildState;
  blocked: boolean;
  message: string;
  commit: string;
  branch: string;
  env: Record<string, string>;
  source: string;
  creator: {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
    created_at: string;
  };
  created_at: string;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  meta_data: Record<string, JsonValue>;
  pull_request: PullRequest | null;
  pipeline: {
    id: string;
    graphql_id: string;
    url: string;
    name: string;
    slug: string;
  };
}

export type BuildState =
  | "passed"
  | "failed"
  | "running"
  | "scheduled"
  | "canceled"
  | "canceling"
  | "skipped"
  | "not_run"
  | "blocked"
  | "creating";

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
  | "failing"
  | "running"
  | "scheduled"
  | "canceled"
  | "canceling"
  | "skipped"
  | "not_run"
  | "blocked"
  | "creating";

export interface Job {
  id: string;
  graphql_id: string;
  type: JobType;
  name: string | null;
  step_key: string | null;
  agent_query_rules: string[];
  state: JobState;
  web_url: string;
  log_url: string;
  raw_log_url: string;
  command: string | null;
  soft_failed: boolean;
  exit_status: number | null;
  artifact_paths: string | null;
  agent: {
    id: string;
    name: string;
    url: string;
  } | null;
  created_at: string;
  scheduled_at: string;
  runnable_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  retried: boolean;
  retried_in_job_id: string | null;
  retries_count: number;
  parallel_group_index: number | null;
  parallel_group_total: number | null;
}

export type JobType =
  | "script"
  | "waiter"
  | "manual"
  | "trigger";

export type JobState =
  | "pending"
  | "waiting"
  | "waiting_failed"
  | "blocked"
  | "blocked_failed"
  | "unblocked"
  | "unblocked_failed"
  | "limiting"
  | "limited"
  | "scheduled"
  | "assigned"
  | "accepted"
  | "running"
  | "passed"
  | "failed"
  | "canceling"
  | "canceled"
  | "timing_out"
  | "timed_out"
  | "skipped"
  | "broken"
  | "expired";

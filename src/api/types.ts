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
  jobs?: Job[]; // Jobs are included in the build response
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
  url: string;
  web_url: string;
  type: string;
  name: string;
  step_key: string | null;
  state: JobState;
  exit_status: number | null;
  command: string;
  soft_failed: boolean;
  agent: {
    id: string;
    graphql_id: string;
    url: string;
    web_url: string;
    name: string;
    connection_state: string;
    hostname: string;
    ip_address: string;
    user_agent: string;
    version: string;
    created_at: string;
  } | null;
  agent_query_rules: string[];
  log_url: string;
  raw_log_url: string | null;
  artifacts_url: string;
  retried: boolean;
  retried_in_job_id: string | null;
  retries_count: number;
  retry_of_job_id: string | null;
  created_at: string;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  unblocked_at: string | null;
  unblocked_by: {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
    created_at: string;
  } | null;
  permit_on_passed?: boolean;
}

/**
 * Checks if a job can be retried.
 * Jobs can be retried if they are:
 * - failed
 * - timed_out
 * - passed (only if permit_on_passed is true)
 */
export function canRetryJob(job: Job): boolean {
  if (job.state === "failed" || job.state === "timed_out") {
    return true;
  }
  if (job.state === "passed" && job.permit_on_passed === true) {
    return true;
  }
  return false;
}

export type JobState =
  | "scheduled"
  | "running"
  | "passed"
  | "failed"
  | "timed_out"
  | "blocked"
  | "canceled"
  | "canceling"
  | "skipped"
  | "not_run"
  | "waiting"
  | "waiting_failed";

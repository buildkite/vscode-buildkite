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
  label?: string | null;
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
  unblockable?: boolean;
  unblock_url?: string | null;
  unblocked_at: string | null;
  unblocked_by: {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
    created_at: string;
  } | null;
  permit_on_passed?: boolean;
  fields?: BlockStepField[];
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

export interface Artifact {
  id: string;
  job_id: string;
  url: string;
  download_url: string;
  state: string;
  path: string;
  dirname: string;
  filename: string;
  mime_type: string;
  file_size: number;
  sha1sum: string;
}

/**
 * Checks if a job can be unblocked.
 * Jobs can be unblocked if they are manual block steps that haven't been unblocked yet.
 */
export function canUnblockJob(job: Job): boolean {
  return job.type === "manual" && job.unblockable === true && job.unblocked_at === null;
}

/**
 * Gets a human-readable display name for a job.
 * Falls back through multiple fields to find the best available name.
 */
export function getJobDisplayName(job: Job): string {
  return job.name || job.label || job.step_key || job.type || "Unnamed job";
}

export type JobState =
  | "pending"
  | "waiting"
  | "assigned"
  | "accepted"
  | "scheduled"
  | "running"
  | "passed"
  | "failed"
  | "timed_out"
  | "blocked"
  | "canceled"
  | "canceling"
  | "timing_out"
  | "skipped"
  | "broken"
  | "unblocked"
  | "not_run"
  | "waiting_failed";

export type AgentConnectionState =
  | "connected"
  | "disconnected"
  | "stopping"
  | "stopped";

/** Minimal job info shown on an agent (current job) */
export interface AgentJobInfo {
  id: string;
  name: string;
  state: string;
  type: string;
  web_url?: string;
}

/** User who paused the agent (when agent is paused). */
export interface AgentPausedBy {
  id: string;
  graphql_id: string;
  name: string;
  email: string;
  avatar_url: string;
  created_at: string;
}

export interface Agent {
  id: string;
  graphql_id?: string;
  url: string;
  web_url: string;
  name: string;
  connection_state: AgentConnectionState;
  hostname: string;
  ip_address: string;
  user_agent: string;
  version: string;
  creator: {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
    created_at: string;
  } | null;
  created_at: string;
  job: AgentJobInfo | null;
  last_job_finished_at: string | null;
  priority: number | null;
  meta_data: string[];
  paused?: boolean;
  paused_at?: string | null;
  paused_by?: AgentPausedBy | null;
  paused_note?: string | null;
  paused_timeout_in_minutes?: number;
  cluster_url?: string;
  cluster_queue_url?: string;
}

/**
 * Base properties shared by all block step field types
 */
interface BaseStepField {
  key: string;
  hint?: string;
  required?: boolean;
}

/**
 * Text input field for block steps
 */
export interface TextStepField extends BaseStepField {
  text: string;
  default?: string;
  format?: string;
}

/**
 * Select/dropdown field for block steps
 */
export interface SelectStepField extends BaseStepField {
  select: string;
  options: Array<string | { label: string; value: string }>;
  multiple?: boolean;
  default?: string | string[];
}

/**
 * Discriminated union of all block step field types
 */
export type BlockStepField = TextStepField | SelectStepField;

/**
 * Type guard to check if a field is a text field
 */
export function isTextStepField(field: BlockStepField): field is TextStepField {
  return "text" in field;
}

/**
 * Type guard to check if a field is a select field
 */
export function isSelectStepField(field: BlockStepField): field is SelectStepField {
  return "select" in field;
}

// GraphQL response types for repository-based pipeline queries

export interface GraphQLBuildNode {
  number: number;
  state: string;
  branch: string;
  message: string | null;
  url: string;
}

export interface GraphQLPipelineNode {
  slug: string;
  name: string;
  repository: {
    url: string;
  };
  builds: {
    edges: Array<{
      node: GraphQLBuildNode;
    }>;
  };
}

export interface PipelinesForRepositoryResponse {
  organization: {
    pipelines: {
      edges: Array<{
        node: GraphQLPipelineNode;
      }>;
    };
  };
}

/** Result from getPipelinesByRepository, combining pipeline and recent builds */
export interface PipelineWithBuilds {
  pipeline: Pipeline;
  builds: Build[];
}

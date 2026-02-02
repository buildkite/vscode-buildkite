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
  jobs?: Job[];
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
  type: string;
  name: string | null;
  label?: string | null;
  state: JobState;
  web_url: string;
  unblockable?: boolean;
  unblock_url?: string | null;
  unblocked_at?: string | null;
  unblocked_by?: {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
    created_at: string;
  } | null;
  fields?: BlockStepField[];
}

export type JobState =
  | "pending"
  | "waiting"
  | "assigned"
  | "accepted"
  | "running"
  | "passed"
  | "failed"
  | "canceled"
  | "canceling"
  | "timing_out"
  | "timed_out"
  | "skipped"
  | "broken"
  | "blocked"
  | "unblocked";

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
  return 'text' in field;
}

/**
 * Type guard to check if a field is a select field
 */
export function isSelectStepField(field: BlockStepField): field is SelectStepField {
  return 'select' in field;
}

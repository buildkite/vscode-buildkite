import {
  Build,
  BuildState,
  JobState,
  AgentConnectionState,
} from "../api/types";

/**
 * Maps Buildkite build states to VS Code codicon names.
 * Codicons: https://code.visualstudio.com/api/references/icons-in-labels
 */
export function getIconForBuild(state: BuildState): string {
  switch (state) {
    case "passed":
      return "pass";
    case "failed":
      return "error";
    case "failing":
      return "warning";
    case "running":
      return "sync~spin";
    case "scheduled":
      return "clock";
    case "canceled":
      return "circle-slash";
    case "canceling":
      return "loading~spin";
    case "skipped":
      return "dash";
    case "not_run":
      return "circle-outline";
    case "blocked":
      return "debug-pause";
    case "creating":
      return "loading~spin";
    default:
      return "circle-outline";
  }
}

/**
 * Priority order for build states (higher = more critical).
 * Used to determine which state to display when aggregating multiple builds.
 */
const STATE_PRIORITY: Record<BuildState, number> = {
  failed: 100,
  failing: 95,
  canceling: 90,
  canceled: 80,
  running: 70,
  creating: 60,
  scheduled: 50,
  blocked: 40,
  passed: 30,
  skipped: 20,
  not_run: 10,
};

/**
 * Gets the icon for the most critical state among multiple builds.
 * Uses "worst state wins" logic: failed > running > passed, etc.
 *
 * @param builds - Array of builds to aggregate
 * @returns The codicon name for the most critical state
 */
export function getAggregateIcon(builds: Build[]): string {
  if (builds.length === 0) {
    return "circle-outline";
  }

  const worstState = builds.reduce((worst, build) => {
    const currentPriority = STATE_PRIORITY[build.state] ?? 0;
    const worstPriority = STATE_PRIORITY[worst] ?? 0;
    return currentPriority > worstPriority ? build.state : worst;
  }, builds[0].state);

  return getIconForBuild(worstState);
}

/**
 * Maps Buildkite job states to VS Code codicon names.
 * Codicons: https://code.visualstudio.com/api/references/icons-in-labels
 */
export function getIconForJob(state: JobState): string {
  switch (state) {
    case "passed":
      return "pass";
    case "failed":
      return "error";
    case "running":
      return "sync~spin";
    case "scheduled":
      return "clock";
    case "canceled":
      return "circle-slash";
    case "canceling":
      return "loading~spin";
    case "skipped":
      return "dash";
    case "not_run":
      return "circle-outline";
    case "blocked":
      return "debug-pause";
    case "waiting":
      return "clock";
    case "waiting_failed":
      return "error";
    case "timed_out":
      return "error";
    default:
      return "circle-outline";
  }
}

/**
 * Maps Buildkite agent connection states to VS Code codicon names.
 * When connected but paused: pause icon. When running a job: spinner.
 * Otherwise: vm-active (idle) or vm-outline / circle-slash for other states.
 */
export function getIconForAgent(
  state: AgentConnectionState,
  paused?: boolean,
  runningJob?: boolean,
): string {
  if (state === "connected" && paused) {
    return "debug-pause";
  }
  if (state === "connected" && runningJob) {
    return "sync~spin";
  }
  switch (state) {
    case "connected":
      return "vm-active";
    case "disconnected":
      return "vm-outline";
    case "stopping":
      return "loading~spin";
    case "stopped":
      return "circle-slash";
    default:
      return "vm-outline";
  }
}

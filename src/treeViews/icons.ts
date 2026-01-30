import { Build, BuildState } from "../api/types";

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

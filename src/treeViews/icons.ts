import { BuildState } from "../api/types";

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

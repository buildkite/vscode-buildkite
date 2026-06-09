import * as vscode from "vscode";
import { track } from "../analytics/analytics";

/**
 * Command handler that lists jobs for a Buildkite pipeline.
 * Currently a placeholder implementation.
 */
export async function listJobs() {
  track("job list");
  // This will do nothing but show an "toast" at the bottom of the screen with the message
  vscode.window.showInformationMessage("Listing Buildkite Jobs...");
}

import * as vscode from "vscode";

/**
 * Command handler that lists jobs for a Buildkite pipeline.
 * Currently a placeholder implementation.
 */
export async function listJobs() {
  // This will do nothing but show an "toast" at the bottom of the screen with the message
  vscode.window.showInformationMessage("Listing Buildkite Jobs...");
}

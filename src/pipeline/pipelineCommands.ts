import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";

/**
 * Command handler that fetches and displays the number of pipelines
 * in the user's Buildkite organization.
 * Shows an information message with the pipeline count on success,
 * or an error message if the request fails.
 */
export async function listPipelines() {
  try {
    const client = new BuildkiteClient();
    const org = await client.getOrganization();
    // This is a basic call and doesn't factor in pagination, it's just to demonstrate making an API call to an endpoint
    const pipelines = await client.get(`/organizations/${org.slug}/pipelines`);
    vscode.window.showInformationMessage(
      `Found ${Array.isArray(pipelines) ? pipelines.length : 0} pipelines`,
    );
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(error.message);
    }
  }
}

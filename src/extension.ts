import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { listPipelines } from "./pipeline/pipelineCommands";
import { listJobs } from "./job/jobCommands";
import { initTreeViews } from "./treeViews/treeViews";
import { openBuildUrl } from "./commands/openBuildUrl";
import { retryBuild } from "./commands/retryBuild";

/**
 * Sets the buildkite.hasToken context for view visibility.
 */
async function updateTokenContext(hasToken: boolean): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    "buildkite.hasToken",
    hasToken,
  );
}

/**
 * Activates the Buildkite VS Code extension.
 * Initializes authentication and registers all commands for managing
 * Buildkite API tokens, pipelines, and jobs.
 * @param context - The extension context provided by VS Code
 */
export async function activate(context: vscode.ExtensionContext) {
  AuthManager.initialize(context);

  // Initialize tree views first
  initTreeViews(context);

  // Set context for view visibility after tree views are initialized
  const hasToken = await AuthManager.getToken();
  await updateTokenContext(!!hasToken);

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.setToken", async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Enter your Buildkite API Token",
        password: true,
        ignoreFocusOut: true,
      });
      if (token) {
        await AuthManager.setToken(token);
        await updateTokenContext(true);
        vscode.window.showInformationMessage(
          "Buildkite API Token saved securely.",
        );
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      await AuthManager.clearToken();
      await updateTokenContext(false);
      vscode.window.showInformationMessage("Buildkite API Token cleared.");
    }),
  );

  // Register Pipeline Commands
  // We need to add each command available to the array of subscriptions
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.listPipelines", listPipelines),
  );

  // Register Job Commands
  // We need to add each command available to the array of subscriptions
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.listJobs", listJobs),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.build.open", openBuildUrl),
    vscode.commands.registerCommand("buildkite.build.retry", retryBuild),
  );
}

/**
 * Deactivates the extension.
 * Called when the extension is deactivated by VS Code.
 */
export function deactivate() {}

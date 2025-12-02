import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { listPipelines } from "./pipeline/pipelineCommands";
import { listJobs } from "./job/jobCommands";

/**
 * Activates the Buildkite VS Code extension.
 * Initializes authentication and registers all commands for managing
 * Buildkite API tokens, pipelines, and jobs.
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  AuthManager.initialize(context);

  // Register Auth Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.setToken", async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Enter your Buildkite API Token",
        password: true,
        ignoreFocusOut: true,
      });
      if (token) {
        await AuthManager.setToken(token);
        vscode.window.showInformationMessage(
          "Buildkite API Token saved securely.",
        );
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      await AuthManager.clearToken();
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
}

/**
 * Deactivates the extension.
 * Called when the extension is deactivated by VS Code.
 */
export function deactivate() {}

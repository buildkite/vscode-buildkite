import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { initTreeViews, getPipelinesTreeProvider } from "./treeViews/treeViews";
import { initStatusBar, getStatusBarManager } from "./statusBar/statusBar";
import { openBuildUrl } from "./commands/openBuildUrl";
import { rebuildBuild } from "./commands/rebuildBuild";
import { cancelBuild } from "./commands/cancelBuild";
import { unblockBuild } from "./commands/unblockBuild";
import { retryJob } from "./commands/retryJob";
import { unblockJob } from "./commands/unblockJob";
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
  initTreeViews(context);
  initStatusBar(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.setToken", async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Enter your Buildkite API Token",
        password: true,
        ignoreFocusOut: true,
      });
      if (token) {
        await AuthManager.setToken(token);
        await getPipelinesTreeProvider().refresh();
        await getStatusBarManager()?.refresh();
        vscode.window.showInformationMessage(
          "Buildkite API Token saved securely.",
        );
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      await AuthManager.clearToken();
      await getPipelinesTreeProvider().refresh();
      await getStatusBarManager()?.refresh();
      vscode.window.showInformationMessage("Buildkite API Token cleared.");
    }),
  );

  // Register Pipeline and Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.listPipelines", listPipelines),
    vscode.commands.registerCommand("buildkite.listJobs", listJobs),
  );

  // Register Build Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.build.open", openBuildUrl),
    vscode.commands.registerCommand("buildkite.build.rebuild", rebuildBuild),
    vscode.commands.registerCommand("buildkite.build.cancel", cancelBuild),
    vscode.commands.registerCommand("buildkite.build.unblock", unblockBuild),
  );

  // Register Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.job.retry", retryJob),
    vscode.commands.registerCommand("buildkite.job.unblock", unblockJob),
  );
}

/**
 * Deactivates the extension.
 * Called when the extension is deactivated by VS Code.
 */
export function deactivate() {}

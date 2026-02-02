import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { initTreeViews, getPipelinesTreeProvider } from "./treeViews/treeViews";
import { initStatusBar, getStatusBarManager } from "./statusBar/statusBar";
import { openBuildUrl } from "./commands/openBuildUrl";
import { rebuildBuild } from "./commands/rebuildBuild";
import { cancelBuild } from "./commands/cancelBuild";
import { viewJobLog, disposeJobLogChannel } from "./commands/viewJobLog";
import { listPipelines } from "./pipeline/pipelineCommands";
import { listJobs } from "./job/jobCommands";
import { Logger } from "./job/jobLogOutput";

/**
 * Activates the Buildkite VS Code extension.
 * Initializes authentication and registers all commands for managing
 * Buildkite API tokens, pipelines, and jobs.
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  // Initialize logger
  const logger = Logger.getInstance();
  logger.info('Buildkite extension activating...');

  AuthManager.initialize(context);
  initTreeViews(context);
  initStatusBar(context);

  logger.info('Buildkite extension initialized successfully');

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.setToken", async () => {
      logger.debug('User requested to set API token');
      const token = await vscode.window.showInputBox({
        prompt: "Enter your Buildkite API Token",
        password: true,
        ignoreFocusOut: true,
      });
      if (token) {
        await AuthManager.setToken(token);
        await getPipelinesTreeProvider().refresh();
        await getStatusBarManager()?.refresh();
        logger.info('API token saved successfully');
        vscode.window.showInformationMessage(
          "Buildkite API Token saved securely.",
        );
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      logger.debug('User requested to clear API token');
      await AuthManager.clearToken();
      await getPipelinesTreeProvider().refresh();
      await getStatusBarManager()?.refresh();
      logger.info('API token cleared successfully');
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
  );

  // Register Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.job.viewLog", viewJobLog),
  );
}

/**
 * Deactivates the extension.
 * Called when the extension is deactivated by VS Code.
 */
export function deactivate() {
  Logger.getInstance().dispose();
  disposeJobLogChannel();
}

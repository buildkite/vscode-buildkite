import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import {
  initTreeViews,
  getPipelinesTreeProvider,
  getAgentsTreeProvider,
} from "./treeViews/treeViews";
import { initStatusBar, getStatusBarManager } from "./statusBar/statusBar";
import { openBuildUrl } from "./commands/openBuildUrl";
import { createBuild } from "./commands/createBuild";
import { rebuildBuild } from "./commands/rebuildBuild";
import { cancelBuild } from "./commands/cancelBuild";
import { unblockBuild } from "./commands/unblockBuild";
import { retryJob } from "./commands/retryJob";
import { downloadArtifact } from "./commands/downloadArtifact";
import { unblockJob } from "./commands/unblockJob";
import { viewJobLog, disposeJobLogWebview } from "./commands/viewJobLog";
import { stopAgent } from "./commands/stopAgent";
import { forceStopAgent } from "./commands/forceStopAgent";
import { pauseAgent } from "./commands/pauseAgent";
import { resumeAgent } from "./commands/resumeAgent";
import { listPipelines } from "./pipeline/pipelineCommands";
import { listJobs } from "./job/jobCommands";
import { openJobLogUrl } from "./commands/openJobLogUrl";
import { createPipeline } from "./commands/createPipeline";
import { editPipeline } from "./commands/editPipeline";
import { archivePipeline, unarchivePipeline, deletePipeline } from "./commands/archivePipeline";
import { pickPipeline } from "./commands/pickPipeline";

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
        await getAgentsTreeProvider().refresh();
        await getStatusBarManager()?.refresh();
        vscode.window.showInformationMessage(
          "Buildkite API Token saved securely.",
        );
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      await AuthManager.clearToken();
      await getPipelinesTreeProvider().refresh();
      await getAgentsTreeProvider().refresh();
      await getStatusBarManager()?.refresh();
      vscode.window.showInformationMessage("Buildkite API Token cleared.");
    }),
  );

  // Register Pipeline and Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.listPipelines", listPipelines),
    vscode.commands.registerCommand("buildkite.listJobs", listJobs),
    vscode.commands.registerCommand("buildkite.pipeline.create", createPipeline),
    vscode.commands.registerCommand("buildkite.pipeline.edit", editPipeline),
    vscode.commands.registerCommand("buildkite.pipelines.pick", pickPipeline),
    vscode.commands.registerCommand("buildkite.pipeline.archive", archivePipeline),
    vscode.commands.registerCommand("buildkite.pipeline.unarchive", unarchivePipeline),
    vscode.commands.registerCommand("buildkite.pipeline.delete", deletePipeline),
  );

  // Register Build Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.build.open", openBuildUrl),
    vscode.commands.registerCommand("buildkite.build.create", createBuild),
    vscode.commands.registerCommand("buildkite.build.rebuild", rebuildBuild),
    vscode.commands.registerCommand("buildkite.build.cancel", cancelBuild),
    vscode.commands.registerCommand("buildkite.build.unblock", unblockBuild),
  );

  // Register Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.job.viewJobLog", viewJobLog),
    vscode.commands.registerCommand("buildkite.job.openJobLogUrl", openJobLogUrl),
    vscode.commands.registerCommand("buildkite.job.retry", retryJob),
    vscode.commands.registerCommand("buildkite.job.unblock", unblockJob),
  );

  // Register Artifact Commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "buildkite.artifact.download",
      downloadArtifact,
    ),
  );

  // Register Agent Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.agent.stop", stopAgent),
    vscode.commands.registerCommand("buildkite.agent.forceStop", forceStopAgent),
    vscode.commands.registerCommand("buildkite.agent.pause", pauseAgent),
    vscode.commands.registerCommand("buildkite.agent.resume", resumeAgent),
  );

  // Register Agent Filter Commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "buildkite.agents.filter",
      async () => {
        const provider = getAgentsTreeProvider();
        const query = await vscode.window.showInputBox({
          prompt: "Filter agents by name, hostname, or queue tag",
          value: provider.getFilter(),
          placeHolder: "e.g. my-agent, web-01, queue=deploy",
        });
        if (query === undefined) {
          return;
        }
        provider.setFilter(query);
        await vscode.commands.executeCommand(
          "setContext",
          "buildkite.agents.filterActive",
          query.trim().length > 0,
        );
      },
    ),
    vscode.commands.registerCommand(
      "buildkite.agents.clearFilter",
      async () => {
        const provider = getAgentsTreeProvider();
        provider.setFilter("");
        await vscode.commands.executeCommand(
          "setContext",
          "buildkite.agents.filterActive",
          false,
        );
      },
    ),
  );
}

/**
 * Deactivates the extension.
 * Called when the extension is deactivated by VS Code.
 */
export function deactivate() {
  disposeJobLogWebview();
}

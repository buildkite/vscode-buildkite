import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL} from "./api/oauth/constants";
import { resolveScopesFromConfig } from "./api/oauth/scopes";
import { BuildkiteAuthProvider } from "./api/oauth/buildkiteAuthProvider";
import { SessionStore } from "./api/oauth/sessionStore";
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
import { searchDocs } from "./commands/searchDocs";

/**
 * Activates the Buildkite VS Code extension.
 * Initializes authentication and registers all commands for managing
 * Buildkite API tokens, pipelines, and jobs.
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {

  AuthManager.initialize(context);

  // Register the Buildkite OAuth authentication provider.
  const authProvider = new BuildkiteAuthProvider(new SessionStore(context.secrets));
  AuthManager.registerOAuthProvider(authProvider);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      AUTH_PROVIDER_ID,
      AUTH_PROVIDER_LABEL,
      authProvider,
      { supportsMultipleAccounts: false },
    ),
    authProvider,
  );

  initTreeViews(context);
  initStatusBar(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.signIn.OAuth", async () => {
      try {
        const config = vscode.workspace.getConfiguration("buildkite");
        const scopes = resolveScopesFromConfig({
          preset: config.get<string>("oauth.scopePreset"),
          customScopes: config.get<string[]>("oauth.scopes"),
        });
        const session = await vscode.authentication.getSession(
          AUTH_PROVIDER_ID,
          scopes,
          { createIfNone: true },
        );
        if (session) {
          await getPipelinesTreeProvider().refresh();
          await getAgentsTreeProvider().refresh();
          await getStatusBarManager()?.refresh();
          vscode.window.showInformationMessage(
            `Signed in to Buildkite as ${session.account.label}.`,
          );
        }
      } catch (err) {
        if (err instanceof vscode.CancellationError) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Buildkite sign-in failed: ${message}`);
      }
    }),
    vscode.commands.registerCommand("buildkite.signOut.OAuth", async () => {
      const sessions = await authProvider.getSessions();
      if (sessions.length === 0) {
        vscode.window.showInformationMessage("No Buildkite session to sign out.");
        return;
      }
      for (const session of sessions) {
        await authProvider.removeSession(session.id);
      }
      await getPipelinesTreeProvider().refresh();
      await getAgentsTreeProvider().refresh();
      await getStatusBarManager()?.refresh();
      vscode.window.showInformationMessage("Signed out of Buildkite.");
    }),
    vscode.authentication.onDidChangeSessions(async (e) => {
      if (e.provider.id === AUTH_PROVIDER_ID) {
        await getPipelinesTreeProvider().refresh();
        await getAgentsTreeProvider().refresh();
        await getStatusBarManager()?.refresh();
      }
    }),
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

  // Register Support Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.searchDocs", searchDocs),
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

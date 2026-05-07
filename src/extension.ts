import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { BuildkiteClient } from "./api/client";
import { CachedApiClient } from "./cache/cachedApiClient";
import { AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL } from "./api/oauth/constants";
import { BuildkiteAuthProvider } from "./api/oauth/buildkiteAuthProvider";
import { SessionStore } from "./api/oauth/sessionStore";
import { initOAuthLogger, oauthLog } from "./api/oauth/log";
import { AllScopes } from "./api/oauth/scopes";
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
import { viewAnnotations, disposeAnnotationsWebview } from "./commands/viewAnnotations";
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
import { searchDocs } from "./commands/searchDocs";

/**
 * Activates the Buildkite VS Code extension.
 * Initializes authentication and registers all commands for managing
 * Buildkite API tokens, pipelines, and jobs.
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(initOAuthLogger());

  const sessionStore = new SessionStore(context.secrets);
  const authProvider = new BuildkiteAuthProvider(sessionStore);
  const authManager = new AuthManager(context.secrets, authProvider);

  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      AUTH_PROVIDER_ID,
      AUTH_PROVIDER_LABEL,
      authProvider,
      { supportsMultipleAccounts: false },
    ),
    authProvider,
    authManager,
    sessionStore,
  );

  assertScopeListsInSync(context);

  // Build the shared API stack once with the active AuthManager and wrap
  // it in a CachedApiClient, then thread that into every command, the
  // tree views and the status bar
  const restClient = new BuildkiteClient(authManager);
  const client = new CachedApiClient(restClient);
  context.subscriptions.push({ dispose: () => client.dispose() });

  initTreeViews(context, authManager, client);
  initStatusBar(context, authManager, client);

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.signIn.OAuth", () => authManager.signIn()),
    vscode.commands.registerCommand("buildkite.signOut.OAuth", async () => {
      const removed = await authProvider.removeAllSessions();
      if (removed === 0) {
        vscode.window.showInformationMessage("No Buildkite session to sign out.");
        return;
      }
      // PAT is a separate credential, signing out of OAuth doesn't clear
      // it, so warn the user so they aren't surprised when API calls
      // keep working
      const message = (await authManager.hasStoredPat())
        ? "Signed out of Buildkite OAuth. Your stored API token is still active; run \"Buildkite: Clear API Token\" to remove it."
        : "Signed out of Buildkite.";
      vscode.window.showInformationMessage(message);
    }),
    // The provider event covers writes from this window and from other
    // VS Code windows (those flow in through secrets.onDidChange inside
    // SessionStore)
    //
    // Filter out refresh token rotations, which only update the
    // session and don't need a tree refresh
    authProvider.onDidChangeSessions((e) => {
      if (!e.added?.length && !e.removed?.length) {
        return;
      }
      authManager.notifyCredentialChanged();
    }),
    // One subscriber for both OAuth and PAT credential changes so every
    // UI piece stays consistent
    authManager.onDidChangeCredential(() => {
      client.clearAll();
      void getPipelinesTreeProvider().refresh();
      void getAgentsTreeProvider().refresh();
      void getStatusBarManager()?.refresh();
    }),
    vscode.commands.registerCommand("buildkite.setToken", async () => {
      const token = await authManager.promptForApiToken();
      if (token) {
        vscode.window.showInformationMessage("Buildkite API Token saved securely.");
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      await authManager.clearToken();
      vscode.window.showInformationMessage("Buildkite API Token cleared.");
    }),
  );

  // Threads the shared CachedApiClient into every command handler, VS
  // Code passes the original arg(s) (typically a tree node) through
  // unchanged
  const withClient =
    <Args extends unknown[], R>(
      fn: (c: CachedApiClient, ...args: Args) => R,
    ) =>
    (...args: Args) =>
      fn(client, ...args);

  // Register Pipeline and Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.listPipelines", withClient(listPipelines)),
    vscode.commands.registerCommand("buildkite.listJobs", listJobs),
    vscode.commands.registerCommand("buildkite.pipeline.create", withClient(createPipeline)),
    vscode.commands.registerCommand("buildkite.pipeline.edit", withClient(editPipeline)),
    vscode.commands.registerCommand("buildkite.pipelines.pick", pickPipeline),
    vscode.commands.registerCommand("buildkite.pipeline.archive", withClient(archivePipeline)),
    vscode.commands.registerCommand("buildkite.pipeline.unarchive", withClient(unarchivePipeline)),
    vscode.commands.registerCommand("buildkite.pipeline.delete", withClient(deletePipeline)),
  );

  // Register Build Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.build.open", openBuildUrl),
    vscode.commands.registerCommand("buildkite.build.create", withClient(createBuild)),
    vscode.commands.registerCommand("buildkite.build.rebuild", withClient(rebuildBuild)),
    vscode.commands.registerCommand("buildkite.build.cancel", withClient(cancelBuild)),
    vscode.commands.registerCommand("buildkite.build.unblock", withClient(unblockBuild)),
    vscode.commands.registerCommand("buildkite.build.viewAnnotations", withClient(viewAnnotations)),
  );

  // Register Job Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.job.viewJobLog", withClient(viewJobLog)),
    vscode.commands.registerCommand("buildkite.job.openJobLogUrl", openJobLogUrl),
    vscode.commands.registerCommand("buildkite.job.retry", withClient(retryJob)),
    vscode.commands.registerCommand("buildkite.job.unblock", withClient(unblockJob)),
  );

  // Register Artifact Commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "buildkite.artifact.download",
      withClient(downloadArtifact),
    ),
  );

  // Register Agent Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.agent.stop", withClient(stopAgent)),
    vscode.commands.registerCommand("buildkite.agent.forceStop", withClient(forceStopAgent)),
    vscode.commands.registerCommand("buildkite.agent.pause", withClient(pauseAgent)),
    vscode.commands.registerCommand("buildkite.agent.resume", withClient(resumeAgent)),
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

export function deactivate() {
  disposeJobLogWebview();
  disposeAnnotationsWebview();
}

// Warns via the OAuth output channel if package.json's scope enum and
// AllScopes drift out of sync, catching the mismatch the moment the
// extension activates rather than waiting for a user to report it
function assertScopeListsInSync(context: vscode.ExtensionContext): void {
  const pkgScopes = readPackageScopeEnum(context.extension.packageJSON);
  if (!pkgScopes) {
    oauthLog("Scope list assertion skipped: could not locate buildkite.oauth.scopes enum in package.json.");
    return;
  }

  const code = new Set(AllScopes);
  const pkg = new Set(pkgScopes);
  const missing = AllScopes.filter((s) => !pkg.has(s));
  const extra = pkgScopes.filter((s) => !code.has(s));

  if (missing.length || extra.length) {
    const message =
      `Scope list mismatch detected. Missing from package.json: [${missing.join(", ")}]; ` +
      `extra in package.json: [${extra.join(", ")}]`;
    oauthLog(message);
    // Also log to the dev console, a contributor running the extension
    // is more likely to notice a console error than to open the OAuth
    // output channel
    console.error(`Buildkite: ${message}`);
  }
}

// VS Code lets `contributes.configuration` be either an object or an
// array of category objects, walk both shapes and return the first
// scopes enum found
function readPackageScopeEnum(packageJSON: unknown): string[] | undefined {
  const configRaw = (packageJSON as { contributes?: { configuration?: unknown } } | undefined)
    ?.contributes?.configuration;
  const blocks = Array.isArray(configRaw) ? configRaw : configRaw ? [configRaw] : [];
  for (const block of blocks) {
    const value = (block as { properties?: Record<string, { items?: { enum?: unknown } } | undefined> })
      ?.properties?.["buildkite.oauth.scopes"]?.items?.enum;
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
      return value as string[];
    }
  }
  return undefined;
}

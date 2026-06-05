import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { BuildkiteClient } from "./api/client";
import { CachedApiClient } from "./cache/cachedApiClient";
import { AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL } from "./api/oauth/constants";
import { BuildkiteAuthProvider } from "./api/oauth/buildkiteAuthProvider";
import { SessionStore } from "./api/oauth/sessionStore";
import { initLogger, warn } from "./log";
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
import { viewBuildError } from "./commands/viewBuildError";
import { initBuildNotifications } from "./notifications/buildNotifications";
import { initAnalytics, identifyUser, resetIdentity, track, shutdownAnalytics } from "./analytics/analytics";

/**
 * Activates the Buildkite VS Code extension.
 * Initializes authentication and registers all commands for managing
 * Buildkite API tokens, pipelines, and jobs.
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(initLogger());
  context.subscriptions.push(initAnalytics());

  const sessionStore = new SessionStore(context.secrets);
  const authProvider = new BuildkiteAuthProvider(sessionStore);
  const authManager = new AuthManager(context.secrets, authProvider);
  context.subscriptions.push(initBuildNotifications());

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

  const restClient = new BuildkiteClient(authManager);
  const client = new CachedApiClient(restClient);
  context.subscriptions.push({ dispose: () => client.dispose() });

  initTreeViews(context, authManager, client);
  initStatusBar(context, authManager, client);

  // viewsWelcome reads this, when false the sign in / sign up buttons render in
  const updateAuthContext = async (): Promise<void> => {
    const session = await authManager.resolveSession();
    await vscode.commands.executeCommand(
      "setContext",
      "buildkite.authenticated",
      !!session,
    );
  };
  void vscode.commands.executeCommand("setContext", "buildkite.authenticated", false);
  void updateAuthContext();

  // Identify the signed-in user for analytics, or clear identity when signed out.
  // A monotonic token ensures a slow in-flight sync can't clobber a newer one
  // (e.g. a startup getUser resolving after a sign-out has already reset identity).
  let identitySyncSeq = 0;
  const syncAnalyticsIdentity = async (): Promise<void> => {
    const seq = ++identitySyncSeq;
    const session = await authManager.resolveSession();
    if (!session) {
      if (seq === identitySyncSeq) {
        resetIdentity();
      }
      return;
    }
    try {
      const [user, org] = await Promise.all([client.getUser(), client.getOrganization()]);
      if (seq === identitySyncSeq) {
        identifyUser(user.id, org.slug);
      }
    } catch {
      // identify failed; clear identity so events aren't misattributed to a stale user
      if (seq === identitySyncSeq) {
        resetIdentity();
      }
    }
  };

  // Identify on startup if already signed in (onDidChangeCredential won't fire)
  void syncAnalyticsIdentity();

  context.subscriptions.push(
    vscode.commands.registerCommand("buildkite.signIn.OAuth", () => {
      track("auth login", { method: "browser", entry: "command" });
      return authManager.signIn();
    }),
    // status bar and viewsWelcome both route through this so we don't drift
    vscode.commands.registerCommand("buildkite.signIn", () => {
      track("auth login", { method: "browser", entry: "ui" });
      return authManager.requireSession();
    }),
    vscode.commands.registerCommand("buildkite.signUp", () => {
      track("auth signup");
      return vscode.env.openExternal(
        vscode.Uri.parse("https://buildkite.com/platform/get-started/"),
      );
    }),
    vscode.commands.registerCommand("buildkite.signOut.OAuth", () => {
      track("auth logout", { method: "browser" });
      return authManager.signOut();
    }),
    // skip refresh-token rotations, those only update the session, no tree refresh needed
    authProvider.onDidChangeSessions((e) => {
      if (!e.added?.length && !e.removed?.length) {
        return;
      }
      authManager.notifyCredentialChanged();
    }),
    // one subscriber for both OAuth and PAT changes so the UI stays consistent
    authManager.onDidChangeCredential(async () => {
      void updateAuthContext();
      client.clearAll();
      void getPipelinesTreeProvider().refresh();
      void getAgentsTreeProvider().refresh();
      void getStatusBarManager()?.refresh();

      await syncAnalyticsIdentity();
    }),
    vscode.commands.registerCommand("buildkite.setToken", async () => {
      track("auth login", { method: "api_token" });
      const token = await authManager.promptForApiToken();
      if (token) {
        vscode.window.showInformationMessage("Buildkite API Token saved securely.");
      }
    }),
    vscode.commands.registerCommand("buildkite.clearToken", async () => {
      await authManager.clearToken();
      track("auth logout", { method: "api_token" });
      vscode.window.showInformationMessage("Buildkite API Token cleared.");
    }),
  );

  // threads the shared client into commands, VS Code passes their tree node through
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
    vscode.commands.registerCommand("buildkite.build.viewError", withClient(viewBuildError)),
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
        track("agent filter");
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
        track("agent filter", { cleared: true });
        await vscode.commands.executeCommand(
          "setContext",
          "buildkite.agents.filterActive",
          false,
        );
      },
    ),
  );
}

export async function deactivate(): Promise<void> {
  disposeJobLogWebview();
  disposeAnnotationsWebview();
  await shutdownAnalytics();
}

// catches drift between AllScopes and package.json on activation
function assertScopeListsInSync(context: vscode.ExtensionContext): void {
  const diff = diffScopeListsAgainstPackage(context.extension.packageJSON);
  if (!diff) {
    warn("[OAuth] Scope list assertion skipped: could not locate buildkite.oauth.scopes enum in package.json.");
    return;
  }

  if (diff.missing.length || diff.extra.length) {
    const message =
      `Scope list mismatch detected. Missing from package.json: [${diff.missing.join(", ")}]; ` +
      `extra in package.json: [${diff.extra.join(", ")}]`;
    warn(`[OAuth] ${message}`);
  }
}

export interface ScopeListDiff {
  missing: string[];
  extra: string[];
}

export function diffScopeListsAgainstPackage(packageJSON: unknown): ScopeListDiff | undefined {
  const pkgScopes = readPackageScopeEnum(packageJSON);
  if (!pkgScopes) {
    return undefined;
  }
  const code = new Set(AllScopes);
  const pkg = new Set(pkgScopes);
  return {
    missing: AllScopes.filter((s) => !pkg.has(s)),
    extra: pkgScopes.filter((s) => !code.has(s)),
  };
}

export function readPackageScopeEnum(packageJSON: unknown): string[] | undefined {
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

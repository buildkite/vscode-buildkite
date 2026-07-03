/**
 * Shared discovery of the workspace's git remote URLs via the built-in
 * vscode.git extension. Used by the status bar and the pipelines tree view to
 * match workspace repositories against Buildkite pipelines.
 */

import * as vscode from "vscode";
import { GitExtension, API as GitAPI, Repository } from "../types/git";
import { warn } from "../log";

const REPOSITORY_STATE_TIMEOUT_MS = 5000;

export async function getGitApi(): Promise<GitAPI | undefined> {
  const gitExtension =
    vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!gitExtension) {
    return undefined;
  }
  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }
  const api = gitExtension.exports.getAPI(1);

  // Wait for the Git API to be fully initialized (repositories discovered)
  if (api.state === "uninitialized") {
    await new Promise<void>((resolve) => {
      const disposable = api.onDidChangeState((state) => {
        if (state === "initialized") {
          disposable.dispose();
          resolve();
        }
      });
    });
  }

  return api;
}

/**
 * Collects the fetch/push URLs of every remote across all open repositories.
 * Duplicate URLs within a repository are collapsed; the same remote appearing
 * in multiple repositories is not.
 */
export async function getWorkspaceRemoteUrls(): Promise<string[]> {
  const gitApi = await getGitApi();
  if (!gitApi) {
    return [];
  }

  const remotes: string[] = [];
  for (const repo of gitApi.repositories) {
    // Wait for repository state to be populated if remotes are empty
    if (repo.state.remotes.length === 0) {
      await waitForRepositoryState(repo);
    }

    for (const remote of repo.state.remotes) {
      if (remote.fetchUrl) {
        remotes.push(remote.fetchUrl);
      }
      if (remote.pushUrl && remote.pushUrl !== remote.fetchUrl) {
        remotes.push(remote.pushUrl);
      }
    }
  }
  return remotes;
}

function waitForRepositoryState(repo: Repository): Promise<void> {
  return new Promise((resolve) => {
    // If already has remotes, resolve immediately
    if (repo.state.remotes.length > 0) {
      resolve();
      return;
    }

    const disposable = repo.state.onDidChange(() => {
      if (repo.state.remotes.length > 0) {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      }
    });

    const timer = setTimeout(() => {
      disposable.dispose();
      warn("[WorkspaceRemotes] timed out waiting for git repository remotes");
      resolve();
    }, REPOSITORY_STATE_TIMEOUT_MS);
  });
}

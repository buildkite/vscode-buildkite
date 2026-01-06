/**
 * Type definitions for VS Code's built-in Git extension API.
 * Based on: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */

import { Uri, Event } from "vscode";

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}

export interface API {
  readonly state: "uninitialized" | "initialized";
  readonly onDidChangeState: Event<"uninitialized" | "initialized">;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  readonly remotes: Remote[];
  readonly onDidChange: Event<void>;
}

export interface Branch {
  readonly name: string | undefined;
  readonly commit: string | undefined;
  readonly upstream?: { name: string; remote: string };
}

export interface Ref {
  readonly type: RefType;
  readonly name: string | undefined;
  readonly commit: string | undefined;
  readonly remote?: string;
}

export const enum RefType {
  Head,
  RemoteHead,
  Tag,
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl: string | undefined;
  readonly pushUrl: string | undefined;
  readonly isReadOnly: boolean;
}

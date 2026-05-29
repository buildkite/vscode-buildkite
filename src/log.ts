import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

export function initLogger(): vscode.Disposable {
  channel = vscode.window.createOutputChannel("Buildkite", { log: true });
  const created = channel;
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      created.dispose();
      // null the ref so a later activate() doesn't write to a disposed channel
      if (channel === created) {
        channel = undefined;
      }
    },
  };
}

export function trace(message: string): void {
  channel?.trace(message);
}

export function debug(message: string): void {
  channel?.debug(message);
}

export function info(message: string): void {
  channel?.info(message);
}

export function warn(message: string): void {
  channel?.warn(message);
}

export function error(message: string): void {
  channel?.error(message);
}

// only redact in messages that smell credential-y, keeps urls and stack
// traces readable, no \b boundaries because _ is a word char so it'd
// skip refresh_token / access_token
const CREDENTIAL_CONTEXT_PATTERN = /(token|bearer|secret|refresh|access|credential|authorization)/i;
const CREDENTIAL_SHAPE_PATTERN = /[A-Za-z0-9_\-.]{24,}/g;

export function redactIfCredentialShaped(s: string): string {
  return CREDENTIAL_CONTEXT_PATTERN.test(s)
    ? s.replace(CREDENTIAL_SHAPE_PATTERN, "[redacted]")
    : s;
}

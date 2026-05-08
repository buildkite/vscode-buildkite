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
      // Null the module level ref so a later activate() in the same host
      // doesn't write to a disposed channel
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

// Redact 24+ char base64url or JWT runs only when the message looks
// like it could be a credential, which keeps URLs and stack trace paths
// in unrelated errors readable while preventing a stray token from a
// server error_description landing verbatim in the output channel or a
// toast
// No word boundaries because they exclude `refresh_token`, `access_token`
// etc since `_` counts as a word char
const CREDENTIAL_CONTEXT_PATTERN = /(token|bearer|secret|refresh|access|credential|authorization)/i;
const CREDENTIAL_SHAPE_PATTERN = /[A-Za-z0-9_\-.]{24,}/g;

export function redactIfCredentialShaped(s: string): string {
  return CREDENTIAL_CONTEXT_PATTERN.test(s)
    ? s.replace(CREDENTIAL_SHAPE_PATTERN, "[redacted]")
    : s;
}

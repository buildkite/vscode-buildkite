import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function initOAuthLogger(): vscode.Disposable {
  channel = vscode.window.createOutputChannel("Buildkite (OAuth)");
  const created = channel;
  return {
    dispose: () => {
      created.dispose();
      // Null the module level ref so a later activate() in the same host
      // doesn't write to a disposed channel
      if (channel === created) {
        channel = undefined;
      }
    },
  };
}

export function oauthLog(message: string): void {
  channel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

// Redact 24+ char base64url or JWT runs only when the message looks
// like it could be a credential, which keeps URLs and stack trace paths
// in unrelated errors readable while preventing a stray token from a
// server error_description landing verbatim in the output channel or a
// toast
const CREDENTIAL_CONTEXT_PATTERN = /\b(token|bearer|secret|refresh|access|credential|authorization)\b/i;
const CREDENTIAL_SHAPE_PATTERN = /[A-Za-z0-9_\-.]{24,}/g;

export function redactIfCredentialShaped(s: string): string {
  return CREDENTIAL_CONTEXT_PATTERN.test(s)
    ? s.replace(CREDENTIAL_SHAPE_PATTERN, "[redacted]")
    : s;
}

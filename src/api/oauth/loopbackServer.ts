import * as http from "http";
import { AddressInfo } from "net";
import * as vscode from "vscode";


export interface LoopbackResult {
  code: string;
  state: string;
}

export interface LoopbackHandle {
  redirectUri: string;
  waitForCallback(): Promise<LoopbackResult>;
  dispose(): void;
}


export async function startLoopbackServer(
  expectedState: string,
  timeoutMs: number,
): Promise<LoopbackHandle> {
  let settled = false;
  let resolve!: (result: LoopbackResult) => void;
  let reject!: (err: Error) => void;
  const done = new Promise<LoopbackResult>((res, rej) => {
    resolve = (value) => {
      settled = true;
      res(value);
    };
    reject = (err) => {
      settled = true;
      rej(err);
    };
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      respondFailure(res, `${error}${errorDescription ? `: ${errorDescription}` : ""}`);
      reject(new Error(`Authorization failed: ${error}${errorDescription ? ` (${errorDescription})` : ""}`));
      return;
    }

    if (!code) {
      respondFailure(res, "Missing authorization code");
      reject(new Error("Authorization response did not include a code"));
      return;
    }

    if (state !== expectedState) {
      respondFailure(res, "State mismatch — possible CSRF attack");
      reject(new Error("OAuth state mismatch — refusing to continue"));
      return;
    }

    respondSuccess(res);
    resolve({ code, state });
  });

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rej);
      res();
    });
  });

  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const timeout = setTimeout(() => {
    reject(new Error("Timed out waiting for Buildkite sign-in to complete."));
  }, timeoutMs);

  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimeout(timeout);
    server.close();
    if (!settled) {
      reject(new vscode.CancellationError());
    }
  };

  const waitForCallback = async () => {
    try {
      return await done;
    } finally {
      dispose();
    }
  };

  return { redirectUri, waitForCallback, dispose };
}

function respondSuccess(res: http.ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>Buildkite sign-in successful</title></head>
<body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 3rem;">
  <h1>&#10003; Signed in to Buildkite</h1>
  <p>You can close this tab and return to VS Code.</p>
</body>
</html>`);
}

function respondFailure(res: http.ServerResponse, message: string) {
  res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>Buildkite sign-in failed</title></head>
<body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 3rem;">
  <h1>&#10005; Sign-in failed</h1>
  <p>${escapeHtml(message)}</p>
  <p>You can close this tab and try again from VS Code.</p>
</body>
</html>`);
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#39;";
    }
  });
}

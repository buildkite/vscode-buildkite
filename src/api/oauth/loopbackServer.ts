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


export interface LoopbackHandlerContext {
  expectedHost: string;
  expectedState: string;
  resolve: (r: LoopbackResult) => void;
  reject: (err: Error) => void;
}

export function handleLoopbackRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: LoopbackHandlerContext,
): void {
  const remote = req.socket.remoteAddress ?? "";
  if (remote !== "127.0.0.1") {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  if (req.headers.host !== ctx.expectedHost) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  const rawPath = req.url ?? "/";
  if (rawPath !== "/callback" && !rawPath.startsWith("/callback?")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  const url = new URL(rawPath, "http://127.0.0.1");

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    respondFailure(res, `${error}${errorDescription ? `: ${errorDescription}` : ""}`);
    ctx.reject(new Error(`Authorization failed: ${error}${errorDescription ? ` (${errorDescription})` : ""}`));
    return;
  }

  if (!code) {
    respondFailure(res, "Missing authorization code");
    ctx.reject(new Error("Authorization response did not include a code"));
    return;
  }

  if (state !== ctx.expectedState) {
    respondFailure(res, "State mismatch, refusing to continue");
    ctx.reject(new Error("OAuth state mismatch, refusing to continue"));
    return;
  }

  respondSuccess(res);
  const settle = () => ctx.resolve({ code, state });
  res.once("finish", settle);
  res.once("close", settle);
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

  // sentinel until listen() returns, anything earlier fails Host check
  let expectedHost = "<unset>";

  const server = http.createServer((req, res) =>
    handleLoopbackRequest(req, res, { expectedHost, expectedState, resolve, reject }),
  );

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rej);
      res();
    });
  });

  const { port } = server.address() as AddressInfo;
  expectedHost = `127.0.0.1:${port}`;
  const redirectUri = `http://${expectedHost}/callback`;

  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimeout(timeout);
    server.close();
    // close keepalive sockets so the port releases now, not when idle clients give up
    server.closeAllConnections();
    if (!settled) {
      reject(new vscode.CancellationError());
    }
  };

  const timeout = setTimeout(() => {
    reject(new Error("Timed out waiting for Buildkite sign-in to complete."));
    dispose();
  }, timeoutMs);

  const waitForCallback = () => done;

  return { redirectUri, waitForCallback, dispose };
}

// page URL has code+state in it, no-store keeps it out of disk cache and
// no-referrer keeps it out of outbound referer headers
const SECURITY_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function respondSuccess(res: http.ServerResponse) {
  res.writeHead(200, SECURITY_HEADERS);
  res.end(`<!DOCTYPE html>
<html>
<head><title>Buildkite sign-in successful</title></head>
<body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 3rem;">
  <h1>✓ Signed in to Buildkite</h1>
  <p>You can close this tab and return to VS Code.</p>
</body>
</html>`);
}

function respondFailure(res: http.ServerResponse, message: string) {
  res.writeHead(400, SECURITY_HEADERS);
  res.end(`<!DOCTYPE html>
<html>
<head><title>Buildkite sign-in failed</title></head>
<body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 3rem;">
  <h1>✗ Sign-in failed</h1>
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

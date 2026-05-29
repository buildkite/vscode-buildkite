import * as assert from "node:assert/strict";
import * as http from "node:http";
import {
  startLoopbackServer,
  handleLoopbackRequest,
  LoopbackHandlerContext,
  LoopbackResult,
} from "../api/oauth/loopbackServer";

interface MockResponse {
  status: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}

function mockReq(opts: {
  remoteAddress?: string;
  host?: string;
  url?: string;
}): http.IncomingMessage {
  return {
    socket: { remoteAddress: opts.remoteAddress ?? "127.0.0.1" },
    headers: { host: opts.host ?? "127.0.0.1:12345" },
    url: opts.url ?? "/callback",
  } as unknown as http.IncomingMessage;
}

function mockRes(): { res: http.ServerResponse; captured: MockResponse } {
  const captured: MockResponse = { status: undefined, headers: undefined, body: undefined };
  const res = {
    writeHead: (status: number, headers?: Record<string, string>) => {
      captured.status = status;
      captured.headers = headers;
    },
    end: (body?: string) => {
      captured.body = body;
    },
    once: () => res,
  } as unknown as http.ServerResponse;
  return { res, captured };
}

function ctx(over: Partial<LoopbackHandlerContext> = {}): LoopbackHandlerContext & {
  resolved: LoopbackResult | undefined;
  rejected: Error | undefined;
} {
  const out = {
    expectedHost: "127.0.0.1:12345",
    expectedState: "the-state",
    resolved: undefined as LoopbackResult | undefined,
    rejected: undefined as Error | undefined,
    resolve(r: LoopbackResult) { this.resolved = r; },
    reject(e: Error) { this.rejected = e; },
    ...over,
  };
  return out;
}

interface RequestResult {
  status: number;
  body: string;
}

function request(
  base: URL,
  opts: { headers?: Record<string, string>; path?: string } = {},
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port,
        path: opts.path ?? base.pathname + base.search,
        method: "GET",
        headers: opts.headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("loopbackServer", () => {
  it("accepts a valid callback and resolves with code + state", async () => {
    const handle = await startLoopbackServer("the-state", 5000);
    try {
      const cbPromise = handle.waitForCallback();
      const u = new URL(`${handle.redirectUri}?code=the-code&state=the-state`);
      const res = await request(u);

      assert.equal(res.status, 200);
      assert.match(res.body, /Signed in to Buildkite/);

      const result = await cbPromise;
      assert.equal(result.code, "the-code");
      assert.equal(result.state, "the-state");
    } finally {
      handle.dispose();
    }
  });

  it("rejects state mismatch with 400", async () => {
    const handle = await startLoopbackServer("expected", 5000);
    try {
      const cbPromise = handle.waitForCallback();
      const rejection = assert.rejects(cbPromise, /state mismatch/i);
      const u = new URL(`${handle.redirectUri}?code=x&state=wrong`);
      const res = await request(u);

      assert.equal(res.status, 400);
      await rejection;
    } finally {
      handle.dispose();
    }
  });

  it("rejects bad Host header with 403", async () => {
    const handle = await startLoopbackServer("s", 5000);
    try {
      const u = new URL(handle.redirectUri);
      const res = await request(u, {
        headers: { Host: "other.example.com" },
        path: "/callback?code=x&state=s",
      });
      assert.equal(res.status, 403);
    } finally {
      handle.dispose();
    }
  });

  it("returns 404 for paths other than /callback", async () => {
    const handle = await startLoopbackServer("s", 5000);
    try {
      const u = new URL(handle.redirectUri);
      const res = await request(u, { path: "/something-else" });
      assert.equal(res.status, 404);
    } finally {
      handle.dispose();
    }
  });

  it("blocks the //other.example.com/callback path-prefix bypass", async () => {
    const handle = await startLoopbackServer("s", 5000);
    try {
      const u = new URL(handle.redirectUri);
      const res = await request(u, { path: "//other.example.com/callback?code=x&state=s" });
      assert.equal(res.status, 404);
    } finally {
      handle.dispose();
    }
  });

  it("rejects /callback without a code", async () => {
    const handle = await startLoopbackServer("s", 5000);
    try {
      const cbPromise = handle.waitForCallback();
      const rejection = assert.rejects(cbPromise, /code/i);
      const u = new URL(`${handle.redirectUri}?state=s`);
      const res = await request(u);

      assert.equal(res.status, 400);
      await rejection;
    } finally {
      handle.dispose();
    }
  });

  it("surfaces an OAuth `error=` param", async () => {
    const handle = await startLoopbackServer("s", 5000);
    try {
      const cbPromise = handle.waitForCallback();
      const rejection = assert.rejects(cbPromise, /access_denied/);
      const u = new URL(`${handle.redirectUri}?error=access_denied&error_description=user+said+no`);
      const res = await request(u);

      assert.equal(res.status, 400);
      await rejection;
    } finally {
      handle.dispose();
    }
  });

  it("times out if the browser never hits the callback", async () => {
    const handle = await startLoopbackServer("s", 50);
    try {
      await assert.rejects(handle.waitForCallback(), /timed out/i);
    } finally {
      handle.dispose();
    }
  });

  it("dispose() rejects an in-flight wait with CancellationError", async () => {
    const handle = await startLoopbackServer("s", 5000);
    const cbPromise = handle.waitForCallback();
    handle.dispose();

    await assert.rejects(cbPromise, (err: Error) => err.name === "Canceled");
  });

  it("dispose() releases the port (subsequent connect refused)", async () => {
    const handle = await startLoopbackServer("s", 5000);
    const u = new URL(handle.redirectUri);
    handle.dispose();

    await new Promise((r) => setTimeout(r, 50));

    await assert.rejects(request(u), /ECONNREFUSED/);
  });
});

describe("handleLoopbackRequest", () => {
  it("rejects a non-loopback remote address with 403", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ remoteAddress: "10.0.0.5" }), res, c);

    assert.equal(captured.status, 403);
    assert.equal(captured.body, "Forbidden");
    assert.equal(c.resolved, undefined);
    assert.equal(c.rejected, undefined);
  });

  it("rejects an empty remote address with 403", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ remoteAddress: "" }), res, c);

    assert.equal(captured.status, 403);
  });

  it("rejects the dual-stack IPv4-mapped IPv6 form with 403", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ remoteAddress: "::ffff:127.0.0.1" }), res, c);

    assert.equal(captured.status, 403);
  });

  it("rejects a mismatched Host header with 403", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ host: "other.example.com" }), res, c);

    assert.equal(captured.status, 403);
  });

  it("returns 404 for paths other than /callback", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ url: "/something-else" }), res, c);

    assert.equal(captured.status, 404);
  });

  it("returns 404 for the //x/callback path-prefix bypass", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ url: "//other.example.com/callback?code=x&state=the-state" }), res, c);

    assert.equal(captured.status, 404);
  });

  it("rejects /callback without a code", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ url: "/callback?state=the-state" }), res, c);

    assert.equal(captured.status, 400);
    assert.ok(c.rejected, "expected reject to fire");
    assert.match(c.rejected!.message, /code/);
  });

  it("rejects state mismatch with 400", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(mockReq({ url: "/callback?code=x&state=wrong" }), res, c);

    assert.equal(captured.status, 400);
    assert.ok(c.rejected);
    assert.match(c.rejected!.message, /state mismatch/i);
  });

  it("surfaces an OAuth error= query param", () => {
    const { res, captured } = mockRes();
    const c = ctx();

    handleLoopbackRequest(
      mockReq({ url: "/callback?error=access_denied&error_description=user+said+no" }),
      res,
      c,
    );

    assert.equal(captured.status, 400);
    assert.ok(c.rejected);
    assert.match(c.rejected!.message, /access_denied/);
  });
});

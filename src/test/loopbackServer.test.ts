import * as assert from "node:assert/strict";
import * as http from "node:http";
import { startLoopbackServer } from "../api/oauth/loopbackServer";

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

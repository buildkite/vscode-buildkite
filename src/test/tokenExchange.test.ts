import * as assert from "node:assert/strict";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
  RefreshTokenInvalidError,
} from "../api/oauth/tokenExchange";

type FetchArgs = { url: string; init?: RequestInit };

// Replace global fetch for the duration of a test, returns the captured calls
function withFetch(handler: (args: FetchArgs) => Response | Promise<Response>): {
  calls: FetchArgs[];
  restore: () => void;
} {
  const calls: FetchArgs[] = [];
  const original = global.fetch;
  // @ts-expect-error swapping a global for tests
  global.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler({ url, init });
  };
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rawResponse(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

describe("exchangeAuthorizationCode", () => {
  it("posts the expected form body and parses the token response", async () => {
    const stub = withFetch(() =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "read_user read_pipelines",
        token_type: "Bearer",
      }),
    );

    try {
      const result = await exchangeAuthorizationCode({
        webBaseUrl: "https://buildkite.com/",
        clientId: "buildkite-vscode",
        code: "code-abc",
        codeVerifier: "verifier-xyz",
        redirectUri: "http://127.0.0.1:1234/callback",
      });

      assert.deepEqual(result, {
        accessToken: "at",
        refreshToken: "rt",
        expiresIn: 3600,
        scope: "read_user read_pipelines",
        tokenType: "Bearer",
      });

      assert.equal(stub.calls.length, 1);
      assert.equal(stub.calls[0].url, "https://buildkite.com/oauth/token");
      const body = String(stub.calls[0].init?.body);
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code=code-abc/);
      assert.match(body, /code_verifier=verifier-xyz/);
    } finally {
      stub.restore();
    }
  });
});

describe("refreshAccessToken", () => {
  it("includes scopes in the body when provided", async () => {
    const stub = withFetch(() =>
      jsonResponse({ access_token: "new-at", refresh_token: "new-rt" }),
    );

    try {
      await refreshAccessToken({
        webBaseUrl: "https://buildkite.com",
        clientId: "buildkite-vscode",
        refreshToken: "old-rt",
        scopes: ["read_user", "read_pipelines"],
      });

      const body = String(stub.calls[0].init?.body);
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=old-rt/);
      assert.match(body, /scope=read_user\+read_pipelines/);
    } finally {
      stub.restore();
    }
  });

  it("omits scope when the list is empty", async () => {
    const stub = withFetch(() => jsonResponse({ access_token: "at" }));

    try {
      await refreshAccessToken({
        webBaseUrl: "https://buildkite.com",
        clientId: "buildkite-vscode",
        refreshToken: "rt",
        scopes: [],
      });

      const body = String(stub.calls[0].init?.body);
      assert.doesNotMatch(body, /\bscope=/);
    } finally {
      stub.restore();
    }
  });

  it("throws RefreshTokenInvalidError on invalid_grant", async () => {
    const stub = withFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "expired" }, 400),
    );

    try {
      await assert.rejects(
        () =>
          refreshAccessToken({
            webBaseUrl: "https://buildkite.com",
            clientId: "x",
            refreshToken: "rt",
            scopes: [],
          }),
        (err: unknown) => err instanceof RefreshTokenInvalidError,
      );
    } finally {
      stub.restore();
    }
  });

  it("treats invalid_client as a regular Error, not RefreshTokenInvalid", async () => {
    // Wiping the user's session over a config typo would be wrong
    const stub = withFetch(() =>
      jsonResponse({ error: "invalid_client", error_description: "bad client_id" }, 401),
    );

    try {
      await assert.rejects(
        () =>
          refreshAccessToken({
            webBaseUrl: "https://buildkite.com",
            clientId: "x",
            refreshToken: "rt",
            scopes: [],
          }),
        (err: unknown) =>
          err instanceof Error && !(err instanceof RefreshTokenInvalidError),
      );
    } finally {
      stub.restore();
    }
  });

  it("treats unauthorized_client as a regular Error too", async () => {
    const stub = withFetch(() =>
      jsonResponse({ error: "unauthorized_client" }, 401),
    );

    try {
      await assert.rejects(
        () =>
          refreshAccessToken({
            webBaseUrl: "https://buildkite.com",
            clientId: "x",
            refreshToken: "rt",
            scopes: [],
          }),
        (err: unknown) =>
          err instanceof Error && !(err instanceof RefreshTokenInvalidError),
      );
    } finally {
      stub.restore();
    }
  });

  it("redacts a credential-shaped error_description", async () => {
    // If the server ever echoes our refresh_token in error_description, the
    // thrown Error message must not leak it
    const tokenLike = "abcdefghijklmnopqrstuvwxyz0123456789AB";
    const stub = withFetch(() =>
      jsonResponse(
        { error: "invalid_grant", error_description: `refresh_token ${tokenLike} expired` },
        400,
      ),
    );

    try {
      await refreshAccessToken({
        webBaseUrl: "https://buildkite.com",
        clientId: "x",
        refreshToken: "rt",
        scopes: [],
      }).catch((err: Error) => {
        assert.match(err.message, /\[redacted\]/);
        assert.doesNotMatch(err.message, new RegExp(tokenLike));
      });
    } finally {
      stub.restore();
    }
  });

  it("substitutes a byte count for non-JSON error bodies", async () => {
    // A misconfigured proxy returning HTML 502 must not echo our request body
    const stub = withFetch(() => rawResponse("<html>Bad Gateway</html>", 502));

    try {
      await refreshAccessToken({
        webBaseUrl: "https://buildkite.com",
        clientId: "x",
        refreshToken: "rt",
        scopes: [],
      }).catch((err: Error) => {
        assert.match(err.message, /non-JSON response body/);
        assert.match(err.message, /\d+ bytes/);
        assert.doesNotMatch(err.message, /Bad Gateway/);
      });
    } finally {
      stub.restore();
    }
  });

  it("throws a network error when fetch itself rejects", async () => {
    const stub = withFetch(() => {
      throw new Error("ENOTFOUND");
    });

    try {
      await refreshAccessToken({
        webBaseUrl: "https://buildkite.com",
        clientId: "x",
        refreshToken: "rt",
        scopes: [],
      }).catch((err: Error) => {
        assert.match(err.message, /Network error/);
        assert.match(err.message, /ENOTFOUND/);
      });
    } finally {
      stub.restore();
    }
  });
});

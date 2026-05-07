import * as assert from "node:assert/strict";
import { redactIfCredentialShaped } from "../api/oauth/log";

describe("redactIfCredentialShaped", () => {
  it("redacts a JWT-shaped run when the message smells credential-y", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const out = redactIfCredentialShaped(`refresh token: ${jwt}`);
    assert.equal(out, "refresh token: [redacted]");
  });

  it("redacts a base64url access token in context", () => {
    const tok = "abcdefghijklmnopqrstuvwxyz0123456789AB";
    const out = redactIfCredentialShaped(`Bearer ${tok}`);
    assert.match(out, /^Bearer \[redacted\]$/);
  });

  it("does not touch URLs in messages without credential context", () => {
    const msg = "GET https://api.buildkite.com/v2/organizations/acme/pipelines";
    assert.equal(redactIfCredentialShaped(msg), msg);
  });

  it("does not touch a UUID in a non-credential message", () => {
    // 36-char UUID would otherwise match the shape regex
    const msg = "build id 4d35d28a-7c8d-4e7c-9f6e-1234567890ab finished";
    assert.equal(redactIfCredentialShaped(msg), msg);
  });

  it("redacts UUIDs only when context flips it on", () => {
    const id = "4d35d28a-7c8d-4e7c-9f6e-1234567890ab";
    // 'authorization' triggers the context check
    const result = redactIfCredentialShaped(`authorization id=${id}`);
    assert.match(result, /\[redacted\]/);
  });

  it("short runs are left alone even with credential context", () => {
    // Less than 24 chars
    const out = redactIfCredentialShaped("token=abc123");
    assert.equal(out, "token=abc123");
  });

  it("trigger words are case-insensitive", () => {
    const tok = "abcdefghijklmnopqrstuvwxyz0123456789";
    const result = redactIfCredentialShaped(`Refresh: ${tok}`);
    assert.match(result, /\[redacted\]/);
  });
});

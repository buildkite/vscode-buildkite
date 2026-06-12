import * as assert from "node:assert/strict";
import {
  isAllowedBaseUrl,
  resolveConfiguredUrl,
  DEFAULT_API_BASE_URL,
} from "../api/urls";

function configWith(value: string | undefined): { get<T>(key: string): T | undefined } {
  return { get: <T>() => value as T | undefined };
}

describe("isAllowedBaseUrl", () => {
  it("allows https URLs", () => {
    assert.equal(isAllowedBaseUrl("https://buildkite.example.com"), true);
    assert.equal(isAllowedBaseUrl("https://api.buildkite.com/v2"), true);
  });

  it("allows http only for loopback hosts", () => {
    assert.equal(isAllowedBaseUrl("http://localhost:3000"), true);
    assert.equal(isAllowedBaseUrl("http://127.0.0.1:3000/v2"), true);
    assert.equal(isAllowedBaseUrl("http://[::1]:3000"), true);
  });

  it("rejects http to non-loopback hosts", () => {
    assert.equal(isAllowedBaseUrl("http://evil.example.com"), false);
    // not a loopback name, even though it resolves locally on some machines
    assert.equal(isAllowedBaseUrl("http://localhost.example.com"), false);
  });

  it("rejects other schemes and garbage", () => {
    assert.equal(isAllowedBaseUrl("file:///etc/passwd"), false);
    assert.equal(isAllowedBaseUrl("ftp://buildkite.com"), false);
    assert.equal(isAllowedBaseUrl("not a url"), false);
    assert.equal(isAllowedBaseUrl(""), false);
  });
});

describe("resolveConfiguredUrl", () => {
  it("uses the configured https URL, trimming the trailing slash", () => {
    assert.equal(
      resolveConfiguredUrl(configWith("https://bk.internal/v2/"), "apiBaseUrl", DEFAULT_API_BASE_URL),
      "https://bk.internal/v2",
    );
  });

  it("falls back to the default when the configured URL is disallowed", () => {
    assert.equal(
      resolveConfiguredUrl(configWith("http://evil.example.com/v2"), "apiBaseUrl", DEFAULT_API_BASE_URL),
      DEFAULT_API_BASE_URL,
    );
    assert.equal(
      resolveConfiguredUrl(configWith("not a url"), "apiBaseUrl", DEFAULT_API_BASE_URL),
      DEFAULT_API_BASE_URL,
    );
  });

  it("falls back to the default when unset or blank", () => {
    assert.equal(
      resolveConfiguredUrl(configWith(undefined), "apiBaseUrl", DEFAULT_API_BASE_URL),
      DEFAULT_API_BASE_URL,
    );
    assert.equal(
      resolveConfiguredUrl(configWith("   "), "apiBaseUrl", DEFAULT_API_BASE_URL),
      DEFAULT_API_BASE_URL,
    );
  });

  it("allows http for localhost development endpoints", () => {
    assert.equal(
      resolveConfiguredUrl(configWith("http://localhost:8080/v2/"), "apiBaseUrl", DEFAULT_API_BASE_URL),
      "http://localhost:8080/v2",
    );
  });
});

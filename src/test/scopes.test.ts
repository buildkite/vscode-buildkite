import * as assert from "node:assert/strict";
import { AllScopes, ReadOnlyScopes, resolveScopesFromConfig } from "../api/oauth/scopes";

describe("resolveScopesFromConfig", () => {
  it("preset 'all' returns the full list", () => {
    const result = resolveScopesFromConfig({ preset: "all" });
    assert.deepEqual(result, [...AllScopes]);
  });

  it("undefined preset defaults to 'all'", () => {
    assert.deepEqual(resolveScopesFromConfig({}), [...AllScopes]);
  });

  it("preset 'read-only' is just the read_ scopes", () => {
    const result = resolveScopesFromConfig({ preset: "read-only" });
    assert.deepEqual(result, [...ReadOnlyScopes]);
    for (const s of result) {
      assert.ok(s.startsWith("read_"), `${s} is not read-only`);
    }
  });

  it("preset 'custom' with empty list falls back to read_user only", () => {
    assert.deepEqual(
      resolveScopesFromConfig({ preset: "custom", customScopes: [] }),
      ["read_user"],
    );
  });

  it("preset 'custom' with values uses those values", () => {
    const result = resolveScopesFromConfig({
      preset: "custom",
      customScopes: ["read_user", "read_pipelines"],
    });
    assert.deepEqual(result, ["read_user", "read_pipelines"]);
  });

  it("custom values get lowercased and trimmed", () => {
    const result = resolveScopesFromConfig({
      preset: "custom",
      customScopes: ["  Read_User  ", "READ_PIPELINES"],
    });
    assert.deepEqual(result, ["read_user", "read_pipelines"]);
  });

  it("custom values drop duplicates", () => {
    const result = resolveScopesFromConfig({
      preset: "custom",
      customScopes: ["read_user", "read_user", "Read_User"],
    });
    assert.deepEqual(result, ["read_user"]);
  });

  it("empty strings in custom are dropped", () => {
    const result = resolveScopesFromConfig({
      preset: "custom",
      customScopes: ["read_user", "", "  "],
    });
    assert.deepEqual(result, ["read_user"]);
  });

  it("unknown custom scopes are filtered out", () => {
    const result = resolveScopesFromConfig({
      preset: "custom",
      customScopes: ["read_user", "read_pipeliens", "not_a_real_scope"],
    });
    assert.deepEqual(result, ["read_user"]);
  });

  it("falls back to read_user when every custom scope is unknown", () => {
    const result = resolveScopesFromConfig({
      preset: "custom",
      customScopes: ["read_pipeliens", "totally_made_up"],
    });
    assert.deepEqual(result, ["read_user"]);
  });
});

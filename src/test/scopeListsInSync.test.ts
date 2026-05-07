import * as assert from "node:assert/strict";
import { readPackageScopeEnum } from "../extension";

describe("readPackageScopeEnum", () => {
  it("returns the enum when configuration is an object", () => {
    const pkg = {
      contributes: {
        configuration: {
          properties: {
            "buildkite.oauth.scopes": {
              items: { enum: ["read_user", "write_pipelines"] },
            },
          },
        },
      },
    };
    assert.deepEqual(readPackageScopeEnum(pkg), ["read_user", "write_pipelines"]);
  });

  it("returns the enum when configuration is an array of category blocks", () => {
    const pkg = {
      contributes: {
        configuration: [
          { properties: {} },
          {
            properties: {
              "buildkite.oauth.scopes": {
                items: { enum: ["read_user"] },
              },
            },
          },
        ],
      },
    };
    assert.deepEqual(readPackageScopeEnum(pkg), ["read_user"]);
  });

  it("returns undefined when the property is missing", () => {
    assert.equal(readPackageScopeEnum({ contributes: { configuration: { properties: {} } } }), undefined);
  });

  it("returns undefined when contributes is missing entirely", () => {
    assert.equal(readPackageScopeEnum({}), undefined);
    assert.equal(readPackageScopeEnum(undefined), undefined);
    assert.equal(readPackageScopeEnum(null), undefined);
  });

  it("ignores entries that aren't strings", () => {
    const pkg = {
      contributes: {
        configuration: {
          properties: {
            "buildkite.oauth.scopes": {
              items: { enum: ["read_user", 42, null] },
            },
          },
        },
      },
    };
    assert.equal(readPackageScopeEnum(pkg), undefined);
  });
});

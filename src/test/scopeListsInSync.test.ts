import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { readPackageScopeEnum } from "../extension";
import { AllScopes } from "../api/oauth/scopes";

describe("scope lists stay in sync", () => {
  it("AllScopes matches the enum in package.json", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const fromPkg = readPackageScopeEnum(pkg);
    assert.ok(fromPkg, "package.json must declare buildkite.oauth.scopes enum");
    assert.deepEqual([...fromPkg].sort(), [...AllScopes].sort());
  });
});

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

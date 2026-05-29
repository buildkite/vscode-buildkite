import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { readPackageScopeEnum, diffScopeListsAgainstPackage } from "../extension";
import { AllScopes } from "../api/oauth/scopes";
import { DEFAULT_CLIENT_ID } from "../api/oauth/constants";

describe("scope lists stay in sync", () => {
  it("AllScopes matches the enum in package.json", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const fromPkg = readPackageScopeEnum(pkg);
    assert.ok(fromPkg, "package.json must declare buildkite.oauth.scopes enum");
    assert.deepEqual([...fromPkg].sort(), [...AllScopes].sort());
  });

  it("DEFAULT_CLIENT_ID matches the package.json default", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const fromPkg = pkg?.contributes?.configuration?.properties?.["buildkite.oauth.clientId"]?.default;
    assert.equal(fromPkg, DEFAULT_CLIENT_ID);
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

describe("diffScopeListsAgainstPackage", () => {
  it("returns undefined when the enum is missing", () => {
    assert.equal(diffScopeListsAgainstPackage({}), undefined);
  });

  it("returns zero-length diffs when code and package.json match", () => {
    const pkg = {
      contributes: {
        configuration: {
          properties: {
            "buildkite.oauth.scopes": { items: { enum: [...AllScopes] } },
          },
        },
      },
    };
    const diff = diffScopeListsAgainstPackage(pkg);
    assert.deepEqual(diff, { missing: [], extra: [] });
  });

  it("reports scopes that are in code but missing from package.json", () => {
    const subset = AllScopes.slice(0, 3);
    const pkg = {
      contributes: {
        configuration: {
          properties: {
            "buildkite.oauth.scopes": { items: { enum: [...subset] } },
          },
        },
      },
    };
    const diff = diffScopeListsAgainstPackage(pkg);
    assert.ok(diff);
    assert.deepEqual(diff.missing.sort(), AllScopes.slice(3).slice().sort());
    assert.deepEqual(diff.extra, []);
  });

  it("reports scopes that are in package.json but missing from code", () => {
    const pkg = {
      contributes: {
        configuration: {
          properties: {
            "buildkite.oauth.scopes": {
              items: { enum: [...AllScopes, "fictional_scope", "another_made_up"] },
            },
          },
        },
      },
    };
    const diff = diffScopeListsAgainstPackage(pkg);
    assert.ok(diff);
    assert.deepEqual(diff.missing, []);
    assert.deepEqual(diff.extra.sort(), ["another_made_up", "fictional_scope"]);
  });
});

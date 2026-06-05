import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { JobNode } from "../treeViews/nodes/jobNode";
import { Build, Job, Pipeline } from "../api/types";

// Guards the contextValue <-> menu when-clause binding for the view/item/context
// actions. Both classes of bug fixed here are mismatches between the string a
// node emits as its contextValue and the when-clause that gates its action:
//   - a blocked build's "build-<state>:blocked" missed an over-anchored cancel
//     when-clause (5ed)
//   - the job menus only ever see the values JobNode actually emits (7sp)

type MenuEntry = { command: string; when?: string; group?: string };

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
);
const itemMenus: MenuEntry[] = pkg.contributes.menus["view/item/context"];

// Faithful evaluator for the when-clause subset these menus use: `viewItem ==
// literal` and `viewItem =~ /regex/`, joined by `||`. Mirrors how VS Code
// resolves these expressions against the viewItem context key.
function whenMatches(when: string, viewItem: string): boolean {
  return when.split("||").some((raw) => {
    const clause = raw.trim();
    const re = clause.match(/^viewItem\s*=~\s*\/(.+)\/$/);
    if (re) {
      return new RegExp(re[1]).test(viewItem);
    }
    const eq = clause.match(/^viewItem\s*==\s*(.+)$/);
    if (eq) {
      return viewItem === eq[1].trim();
    }
    return false;
  });
}

function whenFor(command: string, group: string): string {
  const entry = itemMenus.find((m) => m.command === command && m.group === group);
  assert.ok(entry?.when, `no ${command} menu entry in group ${group}`);
  return entry.when as string;
}

function actionVisible(command: string, group: string, viewItem: string): boolean {
  return whenMatches(whenFor(command, group), viewItem);
}

describe("build cancel menu visibility (5ed)", () => {
  const pipeline = { slug: "deploy", name: "Deploy" } as Pipeline;
  const build = (state: Build["state"], blocked: boolean) =>
    new BuildNode({ number: 1, state, blocked, branch: "main" } as Build, pipeline, "acme");

  it("shows the inline Cancel icon on a blocked in-progress build", () => {
    const node = build("running", true);
    assert.equal(node.contextValue, "build-running:blocked");
    assert.ok(
      actionVisible("buildkite.build.cancel", "inline", node.contextValue!),
      "inline Cancel must be visible on blocked builds",
    );
  });

  it("shows the inline Cancel icon on a normal in-progress build", () => {
    const node = build("running", false);
    assert.equal(node.contextValue, "build-running");
    assert.ok(actionVisible("buildkite.build.cancel", "inline", node.contextValue!));
  });

  it("hides the inline Cancel icon on a finished build", () => {
    const node = build("passed", false);
    assert.equal(node.contextValue, "build-passed");
    assert.ok(!actionVisible("buildkite.build.cancel", "inline", node.contextValue!));
  });
});

describe("job action menu visibility (7sp)", () => {
  const job = (overrides: Partial<Job>) =>
    new JobNode({ type: "script", state: "running", ...overrides } as Job, 1, "deploy", "acme", "pipeline-uuid", "build-uuid");

  it("shows Retry, not Unblock, on a retriable job", () => {
    const node = job({ state: "failed" });
    assert.equal(node.contextValue, "job.retriable");
    assert.ok(actionVisible("buildkite.job.retry", "inline", node.contextValue!));
    assert.ok(!actionVisible("buildkite.job.unblock", "inline@2", node.contextValue!));
  });

  it("shows Unblock, not Retry, on an unblockable job", () => {
    const node = job({ type: "manual", state: "blocked", unblockable: true, unblocked_at: null });
    assert.equal(node.contextValue, "job.unblockable");
    assert.ok(actionVisible("buildkite.job.unblock", "inline@2", node.contextValue!));
    assert.ok(!actionVisible("buildkite.job.retry", "inline", node.contextValue!));
  });

  // Every contextValue JobNode can emit must drive the action its marker
  // implies. The dropped "job.retriable.unblockable" branch matched neither
  // the retry nor the unblock when-clause; this fails if it is reintroduced.
  it("never emits a job contextValue whose action when-clause cannot match", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/treeViews/nodes/jobNode.ts"),
      "utf8",
    );
    const emitted = [...src.matchAll(/return\s+"(job(?:\.[\w.]+)?)"/g)].map((m) => m[1]);
    assert.ok(emitted.length > 0, "expected JobNode to emit at least one contextValue");

    for (const cv of emitted) {
      if (cv.includes("retriable")) {
        assert.ok(
          whenMatches(whenFor("buildkite.job.retry", "inline"), cv),
          `${cv} must match the Retry when-clause`,
        );
      }
      if (cv.includes("unblockable")) {
        assert.ok(
          whenMatches(whenFor("buildkite.job.unblock", "inline@2"), cv),
          `${cv} must match the Unblock when-clause`,
        );
      }
    }
  });
});

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// Statically scan the extension's own source (not the test tree) for command
// usage. Guards the class of bug where a refactor leaves an
// executeCommand("buildkite.*") call pointing at a command nobody registers,
// which fails silently at runtime.
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test") {
        continue;
      }
      collectSourceFiles(full, acc);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("command registration consistency", () => {
  // out/test/<file>.js -> ../../src
  const srcRoot = path.resolve(__dirname, "../../src");
  const source = collectSourceFiles(srcRoot)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  it("every executeCommand('buildkite.*') resolves to a registered command", () => {
    const executed = new Set<string>();
    // \s* spans newlines so the leading argument is matched even when the call
    // is wrapped across lines.
    for (const m of source.matchAll(/executeCommand\(\s*["'](buildkite\.[\w.]+)["']/g)) {
      executed.add(m[1]);
    }

    const registered = new Set<string>();
    for (const m of source.matchAll(/registerCommand\(\s*["']([\w.]+)["']/g)) {
      registered.add(m[1]);
    }

    assert.ok(executed.size > 0, "expected at least one buildkite executeCommand call");

    const missing = [...executed].filter((cmd) => !registered.has(cmd)).sort();
    assert.deepEqual(
      missing,
      [],
      `invoked via executeCommand but never registered: ${missing.join(", ")}`,
    );
  });
});

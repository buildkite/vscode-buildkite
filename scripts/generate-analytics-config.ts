/**
 * Bakes the PostHog API key into the TypeScript source before compilation.
 * Run automatically as part of `npm run compile` and `vscode:prepublish`.
 *
 * Usage:
 *   POSTHOG_API_KEY=phc_... npx ts-node scripts/generate-analytics-config.ts
 *
 * The generated file is gitignored; it overrides the empty-key fallback in
 * src/analytics/posthogConfig.ts at compile time.
 */
import { writeFileSync } from "fs";
import { join } from "path";

const key = process.env.POSTHOG_API_KEY ?? "";
const outPath = join(__dirname, "../src/analytics/posthogConfig.generated.ts");

writeFileSync(
  outPath,
  `// AUTO-GENERATED - do not edit. See scripts/generate-analytics-config.ts\nexport const POSTHOG_API_KEY = ${JSON.stringify(key)};\n`,
);

console.log(`[generate-analytics-config] Written posthogConfig.generated.ts (key ${key ? "set" : "empty"})`);

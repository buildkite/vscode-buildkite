import * as vscode from "vscode";
import * as path from "path";

const REMOTE_SCHEMA_URL =
  "https://raw.githubusercontent.com/buildkite/pipeline-schema/main/schema.json";
const SCHEMA_FETCH_TIMEOUT = 5000; // 5 seconds

/**
 * File patterns that match Buildkite pipeline YAML files
 */
const BUILDKITE_FILE_PATTERNS = [
  ".buildkite/pipeline.yml",
  ".buildkite/pipeline.yaml",
  ".buildkite/*.yml",
  ".buildkite/*.yaml",
  "buildkite.yml",
  "buildkite.yaml",
];

/**
 * Checks if a given URI matches Buildkite pipeline file patterns
 */
function matchesBuildkitePattern(uri: string): boolean {
  const normalizedUri = uri.replace(/\\/g, "/");

  return BUILDKITE_FILE_PATTERNS.some((pattern) => {
    if (pattern.includes("*")) {
      // Handle glob patterns like ".buildkite/*.yml"
      const regexPattern = pattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, "[^/]*");
      const regex = new RegExp(regexPattern + "$");
      return regex.test(normalizedUri);
    } else {
      // Exact match
      return normalizedUri.endsWith(pattern);
    }
  });
}

/**
 * Attempts to fetch the remote schema with a timeout
 */
async function tryFetchRemoteSchema(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCHEMA_FETCH_TIMEOUT);

    const response = await fetch(REMOTE_SCHEMA_URL, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log(
        "[Buildkite] Successfully validated remote schema availability",
      );
      return REMOTE_SCHEMA_URL;
    }
  } catch (error) {
    console.log(
      "[Buildkite] Remote schema not available, will use local fallback:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return null;
}

/**
 * Gets the local schema file URI
 */
function getLocalSchemaUri(context: vscode.ExtensionContext): string {
  const schemaPath = context.asAbsolutePath(
    path.join("schemas", "buildkite-pipeline.json"),
  );
  return vscode.Uri.file(schemaPath).toString();
}

/**
 * Registers the Buildkite pipeline schema with the YAML extension
 * Tries remote schema first, falls back to local bundled schema
 */
export async function registerBuildkiteSchema(
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    // Get the YAML extension
    const yamlExtension = vscode.extensions.getExtension("redhat.vscode-yaml");

    if (!yamlExtension) {
      console.warn(
        "[Buildkite] YAML extension not found. YAML validation will not be available.",
      );
      return;
    }

    // Activate the YAML extension if not already active
    if (!yamlExtension.isActive) {
      await yamlExtension.activate();
    }

    // Try to use remote schema first, fallback to local
    let schemaUri = await tryFetchRemoteSchema();

    if (!schemaUri) {
      schemaUri = getLocalSchemaUri(context);
      console.log("[Buildkite] Using local bundled schema:", schemaUri);
    } else {
      console.log("[Buildkite] Using remote schema:", schemaUri);
    }

    // Register schema contributor with the YAML extension
    const yamlApi = yamlExtension.exports;

    if (yamlApi && yamlApi.registerContributor) {
      yamlApi.registerContributor(
        "buildkite",
        (resource: string) => {
          if (matchesBuildkitePattern(resource)) {
            return schemaUri;
          }
          return null;
        },
        () => {
          // This function is called to get schema content
          // Return null to let the YAML extension fetch from the URI
          return null;
        },
      );

      console.log(
        "[Buildkite] Successfully registered Buildkite pipeline schema",
      );
    } else {
      console.warn(
        "[Buildkite] YAML extension API not available. Schema registration skipped.",
      );
    }
  } catch (error) {
    console.error(
      "[Buildkite] Error registering YAML schema:",
      error instanceof Error ? error.message : String(error),
    );
    vscode.window.showWarningMessage(
      "Buildkite: Failed to register YAML schema. Pipeline validation may not work.",
    );
  }
}

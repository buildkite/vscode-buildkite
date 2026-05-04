import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { AnnotationsWebview } from "../build/annotationsWebview";

let annotationsWebview: AnnotationsWebview | undefined;

function getAnnotationsWebview(): AnnotationsWebview {
  if (!annotationsWebview) {
    annotationsWebview = new AnnotationsWebview();
  }
  return annotationsWebview;
}

/**
 * Command handler to view annotations for a build.
 * Triggered from the build node context menu.
 */
export async function viewAnnotations(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  const { build, pipeline, orgSlug } = node;
  const buildLabel = `${pipeline.name} #${build.number}`;
  const buildKey = `${orgSlug}/${pipeline.slug}/${build.number}`;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading annotations for ${buildLabel}...`,
      },
      async () => {
        const client = new BuildkiteClient();
        const annotations = await client.getAnnotations(
          orgSlug,
          pipeline.slug,
          build.number,
        );
        getAnnotationsWebview().show(buildKey, buildLabel, annotations);
      },
    );
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(
        `Failed to load annotations: ${error.message}`,
      );
    } else {
      vscode.window.showErrorMessage(
        "Failed to load annotations: An unknown error occurred",
      );
    }
  }
}

/**
 * Disposes the annotations webview. Call from extension deactivate().
 */
export function disposeAnnotationsWebview(): void {
  annotationsWebview?.dispose();
}
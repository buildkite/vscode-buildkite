import * as vscode from "vscode";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { CachedApiClient } from "../cache/cachedApiClient";
import { ArtifactNode } from "../treeViews/nodes/artifactNode";
import { track } from "../analytics/analytics";

const PREVIEWABLE_MIME_PREFIXES = ["text/", "image/", "application/json"];

function isPreviewable(mimeType: string): boolean {
  return PREVIEWABLE_MIME_PREFIXES.some((prefix) =>
    mimeType.startsWith(prefix),
  );
}

export async function downloadArtifact(client: CachedApiClient, node: ArtifactNode): Promise<void> {
  if (!node || !(node instanceof ArtifactNode)) {
    vscode.window.showErrorMessage("Invalid artifact node");
    return;
  }

  const artifact = node.artifact;
  track("artifact download", { pipeline_uuid: node.pipelineUuid, build_uuid: node.buildUuid });

  try {

    if (isPreviewable(artifact.mime_type)) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading ${artifact.filename}...`,
        },
        async () => {
          const response = await client.downloadArtifact(artifact.download_url);
          const tmpDir = path.join(os.tmpdir(), "buildkite-artifacts");
          fs.mkdirSync(tmpDir, { recursive: true });
          const sanitizedName = path.basename(artifact.filename);
          const tmpFile = path.join(tmpDir, sanitizedName);
          const nodeStream = Readable.fromWeb(response.body!);
          await pipeline(nodeStream, fs.createWriteStream(tmpFile));
          const uri = vscode.Uri.file(tmpFile);
          await vscode.commands.executeCommand("vscode.open", uri);
        },
      );
    } else {
      const defaultUri = vscode.Uri.file(
        path.join(os.homedir(), "Downloads", path.basename(artifact.filename)),
      );
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { "All Files": ["*"] },
      });

      if (!saveUri) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading ${artifact.filename}...`,
        },
        async () => {
          const response = await client.downloadArtifact(artifact.download_url);
          const nodeStream = Readable.fromWeb(response.body!);
          await pipeline(nodeStream, fs.createWriteStream(saveUri.fsPath));
          vscode.window.showInformationMessage(
            `Artifact saved to ${saveUri.fsPath}`,
          );
        },
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(
        `Failed to download artifact: ${error.message}`,
      );
    } else {
      vscode.window.showErrorMessage(
        "Failed to download artifact: An unknown error occurred",
      );
    }
  }
}

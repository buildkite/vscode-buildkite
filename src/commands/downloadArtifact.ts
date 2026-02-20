import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { BuildkiteClient } from "../api/client";
import { ArtifactNode } from "../treeViews/nodes/artifactNode";

const PREVIEWABLE_MIME_PREFIXES = ["text/", "image/", "application/json"];

function isPreviewable(mimeType: string): boolean {
  return PREVIEWABLE_MIME_PREFIXES.some((prefix) =>
    mimeType.startsWith(prefix),
  );
}

export async function downloadArtifact(node: ArtifactNode): Promise<void> {
  if (!node || !(node instanceof ArtifactNode)) {
    vscode.window.showErrorMessage("Invalid artifact node");
    return;
  }

  const artifact = node.artifact;

  try {
    const client = new BuildkiteClient();

    if (isPreviewable(artifact.mime_type)) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading ${artifact.filename}...`,
        },
        async () => {
          const data = await client.downloadArtifact(artifact.download_url);
          const tmpDir = path.join(os.tmpdir(), "buildkite-artifacts");
          fs.mkdirSync(tmpDir, { recursive: true });
          const tmpFile = path.join(tmpDir, artifact.filename);
          fs.writeFileSync(tmpFile, Buffer.from(data));
          const uri = vscode.Uri.file(tmpFile);
          await vscode.commands.executeCommand("vscode.open", uri);
        },
      );
    } else {
      const defaultUri = vscode.Uri.file(
        path.join(os.homedir(), "Downloads", artifact.filename),
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
          const data = await client.downloadArtifact(artifact.download_url);
          fs.writeFileSync(saveUri.fsPath, Buffer.from(data));
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

import * as vscode from "vscode";
import { Artifact } from "../../api/types";

export class ArtifactNode extends vscode.TreeItem {
  constructor(
    public readonly artifact: Artifact,
    public readonly pipelineUuid: string,
    public readonly buildUuid: string,
  ) {
    super(artifact.filename, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("file");
    this.tooltip = this.getTooltip();
    this.contextValue = "artifact";
    this.description = artifact.dirname === "." ? undefined : artifact.dirname;

    this.command = {
      command: "buildkite.artifact.download",
      title: "Download Artifact",
      arguments: [this],
    };
  }

  private getTooltip(): string {
    const lines = [
      `File: ${this.artifact.path}`,
      `Size: ${formatFileSize(this.artifact.file_size)}`,
      `Type: ${this.artifact.mime_type}`,
    ];
    return lines.join("\n");
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

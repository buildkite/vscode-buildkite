import * as vscode from "vscode";
import { Annotation } from "../api/types";

/**
 * Webview for displaying build annotations with markdown rendering.
 * Manages multiple panels, one for each unique build.
 */
export class AnnotationsWebview {
  private panels: Map<string, vscode.WebviewPanel>;

  constructor() {
    this.panels = new Map();
  }

  /**
   * Shows build annotations in a webview panel with markdown rendering.
   * Creates a new panel for each unique build, or reuses an existing one.
   * @param buildKey - Unique key for this build (e.g. "org/pipeline/buildNumber")
   * @param buildLabel - Human-readable build label for the panel title
   * @param annotations - Array of annotations to display
   */
  public show(
    buildKey: string,
    buildLabel: string,
    annotations: Annotation[],
  ): void {
    let panel = this.panels.get(buildKey);

    if (panel) {
      panel.reveal();
      panel.webview.html = this.getWebviewContent(buildLabel, annotations);
    } else {
      panel = vscode.window.createWebviewPanel(
        "buildkiteAnnotations",
        `Annotations: ${buildLabel}`,
        vscode.ViewColumn.One,
        {
          enableScripts: false,
        },
      );

      this.panels.set(buildKey, panel);

      panel.onDidDispose(() => {
        this.panels.delete(buildKey);
      });

      panel.webview.html = this.getWebviewContent(buildLabel, annotations);
    }
  }

  /**
   * Returns a CSS class name for a given annotation style.
   */
  private styleClass(style: Annotation["style"]): string {
    const map: Record<Annotation["style"], string> = {
      success: "annotation-success",
      info: "annotation-info",
      warning: "annotation-warning",
      error: "annotation-error",
      default: "annotation-default",
    };
    return map[style] ?? "annotation-info";
  }

  
/**
 * Generates the HTML content for the webview.
 * Renders pre-converted HTML from the Buildkite API directly.
 */
  private getWebviewContent(
    buildLabel: string,
    annotations: Annotation[],
  ): string {
    const annotationItems =
      annotations.length === 0
        ? `<p class="empty">No annotations for this build.</p>`
        : annotations
            .map(
              (a) => `
          <div class="annotation ${this.styleClass(a.style)}">
           <div class="annotation-body">${a.body_html ?? ""}</div>
          </div>`,
            )
            .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Annotations: ${this.escapeHtml(buildLabel)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }
    h1 {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
    }
    .annotation {
      border-left: 4px solid;
      border-radius: 4px;
      margin-bottom: 16px;
      padding: 12px 16px;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }
    .annotation-success { border-color: #4caf50; }
    .annotation-info    { border-color: #2196f3; }
    .annotation-warning { border-color: #ff9800; }
    .annotation-error   { border-color: #f44336; }
    .annotation-default { border-color: #858585; }
   
    .annotation-body p:first-child { margin-top: 0; }
    .annotation-body p:last-child  { margin-bottom: 0; }
    .annotation-body code {
      font-family: var(--vscode-editor-font-family);
      background-color: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .annotation-body pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    .annotation-body pre code {
      background: none;
      padding: 0;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>Build Annotations: ${this.escapeHtml(buildLabel)}</h1>
  ${annotationItems}
</body>
</html>`;
  }

  /**
   * Escapes HTML special characters to prevent XSS.
   */
  private escapeHtml(unsafe: string): string {
    if (!unsafe) { return ""; }
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }



  /**
   * Disposes all webview panels.
   */
  public dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

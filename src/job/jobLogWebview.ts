import * as vscode from "vscode";
import AnsiToHtml from "ansi-to-html";

/**
 * Webview for displaying job logs with ANSI color support.
 * Converts ANSI escape codes to HTML for rich log viewing.
 * Manages multiple panels, one for each unique job.
 */
export class JobLogWebview {
  private panels: Map<string, vscode.WebviewPanel>;
  private panelContents: Map<string, { jobName: string; jobDetails: string, htmlContent: string }>;
  private converter: AnsiToHtml;

  constructor() {
    this.panels = new Map();
    this.panelContents = new Map();
    this.converter = new AnsiToHtml({
      fg: "#d4d4d4",
      bg: "#1e1e1e",
      newline: true,
      escapeXML: true,
    });
  }

  /**
   * Shows the job log in a webview panel with ANSI color support.
   * Creates a new panel for each unique job name.
   * @param jobName - Name of the job for the panel title
   * @param jobDetails - Pipeline, build details of the job
   * @param logContent - Raw log content (may include ANSI escape codes)
   */
  public show(jobName: string, jobDetails: string, logContent: string): void {
    // Convert ANSI to HTML first
    const htmlContent = this.converter.toHtml(logContent);

    // Then process Buildkite timestamps (after ANSI conversion to avoid bracket conflicts)
    const processedHtml = this.processTimestamps(htmlContent);

    // Use job name as the key for this panel
    const panelKey = jobName;

    // Check if panel already exists for this job
    let panel = this.panels.get(panelKey);

    if (panel) {
      // Reuse existing panel for this job
      panel.reveal();
      panel.title = `Job Log: ${jobName}`;
      panel.webview.html = this.getWebviewContent(jobName, jobDetails, processedHtml);
    } else {
      // Create new panel for this job
      panel = vscode.window.createWebviewPanel(
        "buildkiteJobLog",
        `Job Log: ${jobName}`,
        vscode.ViewColumn.One,
        {
          enableScripts: false,
          // retainContextWhenHidden removed for better memory efficiency
        }
      );

      // Store the panel
      this.panels.set(panelKey, panel);

      // Restore content when webview becomes visible
      panel.onDidChangeViewState((e: vscode.WebviewPanelOnDidChangeViewStateEvent) => {
        const storedContent = this.panelContents.get(panelKey);
        if (e.webviewPanel.visible && storedContent) {
          e.webviewPanel.webview.html = this.getWebviewContent(
            storedContent.jobName,
            storedContent.jobDetails,
            storedContent.htmlContent
          );
        }
      });

      panel.onDidDispose(() => {
        // Remove panel and content from storage
        this.panels.delete(panelKey);
        this.panelContents.delete(panelKey);
      });

      panel.webview.html = this.getWebviewContent(jobName, jobDetails, processedHtml);
    }

    // Store content for this panel for memory-efficient restoration
    this.panelContents.set(panelKey, {
      jobName,
      jobDetails,
      htmlContent: processedHtml,
    });
  }

  /**
   * Processes Buildkite timestamp markers (_bk;t=<milliseconds>) and converts them to UTC format.
   * @param content - Raw log content with Buildkite timestamp markers
   * @returns Content with human-readable UTC timestamps
   */
  private processTimestamps(content: string): string {
    // Match Buildkite timestamp pattern: _bk;t=<milliseconds>
    const timestampPattern = /_bk;t=(\d+)/g;

    return content.replace(timestampPattern, (_match, milliseconds) => {
      const timestamp = parseInt(milliseconds, 10);
      const date = new Date(timestamp);

      // Format as UTC: YYYY-MM-DD HH:MM:SS UTC
      const formatted = date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

      return `[${formatted}]`;
    });
  }

  /**
   * Generates the HTML content for the webview.
   */
  private getWebviewContent(jobName: string, jobDetails: string, htmlContent: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Job Log: ${this.escapeHtml(jobName)}</title>
    <style>
        body {
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.4;
            background-color: #1e1e1e;
            color: #d4d4d4;
            padding: 16px;
            margin: 0;
        }
        pre {
            margin: 0;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .header {
            padding: 8px 0;
            margin-bottom: 16px;
            border-bottom: 1px solid #404040;
            color: #858585;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="header">${this.escapeHtml(jobDetails)}</div>
    <pre>${htmlContent}</pre>
</body>
</html>`;
  }

  /**
   * Escapes HTML special characters to prevent XSS.
   */
  private escapeHtml(unsafe: string): string {
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
    // Dispose all panels
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
    this.panelContents.clear();
  }
}

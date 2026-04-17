import * as vscode from "vscode";

export class SupportViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "buildkite.support";

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: false, enableCommandUris: true };
    webviewView.webview.html = this.getHtml();
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 8px 12px;
      margin: 0;
    }
    a {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      margin: 6px 0;
    }
    a:hover {
      text-decoration: underline;
    }
    svg {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
  </style>
</head>
<body>
  <a href="https://buildkite.com/docs">
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2h7l3 3v9H2V2zm1 1v10h8V6H8V3H3zm6 0v2h2l-2-2z"/>
    </svg>
    Documentation
  </a>
  <a href="command:buildkite.openSupportEmail">
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 9.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM8 4c1.38 0 2.5.9 2.5 2.25 0 1.01-.56 1.65-1.4 2.1-.4.22-.6.46-.6.9V9.5H7.5V9c0-.9.46-1.47 1.13-1.82.57-.3.87-.65.87-1.18C9.5 5.36 8.83 5 8 5c-.9 0-1.5.54-1.5 1.25H5C5 4.9 6.12 4 8 4z"/>
    </svg>
    Contact Support
  </a>
</body>
</html>`;
  }
}

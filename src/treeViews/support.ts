import * as vscode from "vscode";
import { searchAlgolia } from "../api/algoliaClient";

export class SupportViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "buildkite.support";

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true, enableCommandUris: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "search") {
        try {
          const results = await searchAlgolia(msg.query);
          webviewView.webview.postMessage({ command: "results", results });
        } catch {
          webviewView.webview.postMessage({ command: "error" });
        }
      } else if (msg.command === "open") {
        const uri = vscode.Uri.parse(msg.url);
        if (uri.scheme === "https") {
          vscode.env.openExternal(uri);
        }
      }
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 8px 12px;
      margin: 0;
    }
    .search-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 6px 0;
    }
    svg {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
    #search-input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 2px 6px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
    }
    #search-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    #results {
      margin-top: 4px;
    }
    .result-item {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      padding: 3px 0;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .result-item:hover {
      text-decoration: underline;
    }
    .status {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      padding: 3px 0;
    }
    a.support-link {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      margin: 6px 0;
    }
    a.support-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <form id="search-form" class="search-row">
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2h7l3 3v9H2V2zm1 1v10h8V6H8V3H3zm6 0v2h2l-2-2z"/>
    </svg>
    <input id="search-input" type="text" placeholder="Search docs…" />
  </form>
  <div id="results"></div>
  <a class="support-link" href="command:buildkite.openSupportEmail">
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 9.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM8 4c1.38 0 2.5.9 2.5 2.25 0 1.01-.56 1.65-1.4 2.1-.4.22-.6.46-.6.9V9.5H7.5V9c0-.9.46-1.47 1.13-1.82.57-.3.87-.65.87-1.18C9.5 5.36 8.83 5 8 5c-.9 0-1.5.54-1.5 1.25H5C5 4.9 6.12 4 8 4z"/>
    </svg>
    Contact Support
  </a>
  <script>
    const vscode = acquireVsCodeApi();
    const resultsEl = document.getElementById('results');

    const searchInput = document.getElementById('search-input');

    searchInput.addEventListener('input', () => {
      if (!searchInput.value.trim()) {
        resultsEl.innerHTML = '';
      }
    });

    document.getElementById('search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (!query) { return; }
      resultsEl.innerHTML = '<div class="status">Searching…</div>';
      vscode.postMessage({ command: 'search', query });
    });

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.command === 'results') {
        if (!msg.results.length) {
          resultsEl.innerHTML = '<div class="status">No results found.</div>';
          return;
        }
        resultsEl.innerHTML = msg.results.map((r) =>
          '<div class="result-item" data-url="' + escapeHtml(r.url) + '">' + escapeHtml(r.title) + '</div>'
        ).join('');
        resultsEl.querySelectorAll('.result-item').forEach((el) => {
          el.addEventListener('click', () => {
            vscode.postMessage({ command: 'open', url: el.dataset.url });
          });
        });
      } else if (msg.command === 'error') {
        resultsEl.innerHTML = '<div class="status">Search failed. Try again.</div>';
      }
    });

    function escapeHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  </script>
</body>
</html>`;
  }
}

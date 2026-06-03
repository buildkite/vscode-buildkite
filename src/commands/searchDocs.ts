import * as vscode from "vscode";
import { searchAlgolia } from "../api/algoliaClient";
import { track } from "../analytics/analytics";
import { info } from "../log";

export async function searchDocs(): Promise<void> {
  info("[searchDocs] command invoked");
  const query = await vscode.window.showInputBox({
    prompt: "Search Buildkite Docs",
    placeHolder: "e.g. pipeline configuration",
  });

  info(`[searchDocs] query entered: "${query}"`);
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    info("[searchDocs] empty query, returning");
    return;
  }

  info(`[searchDocs] firing track for query: "${trimmedQuery}"`);
  track("support.search_docs", { query: trimmedQuery });

  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Searching docs…" },
    () => searchAlgolia(trimmedQuery)
  );

  if (!results.length) {
    vscode.window.showInformationMessage(`No results found for "${trimmedQuery}"`);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    results.map((r) => ({ label: r.title, description: r.url, url: r.url })),
    { placeHolder: "Select a result to open" }
  );

  if (picked) {
    const uri = vscode.Uri.parse(picked.url);
    if (uri.scheme === "https") {
      vscode.env.openExternal(uri);
    }
  }
}

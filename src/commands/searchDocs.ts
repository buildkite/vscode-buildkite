import * as vscode from "vscode";
import { searchAlgolia } from "../api/algoliaClient";
import { track } from "../analytics/analytics";

export async function searchDocs(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Search Buildkite Docs",
    placeHolder: "e.g. pipeline configuration",
  });

  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    return;
  }

  track("docs search", { query: trimmedQuery });

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

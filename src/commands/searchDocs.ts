import * as vscode from "vscode";
import { searchAlgolia } from "../api/algoliaClient";

export async function searchDocs(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Search Buildkite Docs",
    placeHolder: "e.g. pipeline configuration",
  });

  if (!query?.trim()) {
    return;
  }

  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Searching docs…" },
    () => searchAlgolia(query.trim())
  );

  if (!results.length) {
    vscode.window.showInformationMessage(`No results found for "${query}"`);
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

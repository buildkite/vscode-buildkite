import * as vscode from "vscode";
import { JobNode } from "../treeViews/nodes/jobNode"; 

export async function openJobLogUrl(node: JobNode): Promise<void> {
  if (!node || !(node instanceof JobNode)) {
    vscode.window.showErrorMessage("Invalid job node");
    return;
  }

  console.log("Job raw_log_url:", node.job.raw_log_url); 

  //add check if a job log url exists am
  if (!node.job.raw_log_url) {
    vscode.window.showErrorMessage("No log URL available for this job");
    return;
  }
  const uri = vscode.Uri.parse(node.job.raw_log_url);
  await vscode.env.openExternal(uri);
}
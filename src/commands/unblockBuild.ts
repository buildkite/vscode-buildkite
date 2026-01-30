import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { Job, BlockStepField } from "../api/types";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

/**
 * Builds confirmation message with field summary
 */
function buildConfirmationMessage(
  buildNumber: number,
  jobName: string,
  fieldValues?: Record<string, string | string[]>,
): string {
  let message = `Build #${buildNumber} is waiting on approval for the ${jobName} step.`;

  if (fieldValues && Object.keys(fieldValues).length > 0) {
    message += "\n\nField values:";
    for (const [key, value] of Object.entries(fieldValues)) {
      // Format value for display
      const displayValue = Array.isArray(value)
        ? value.join(", ")
        : value.length > 50
        ? value.substring(0, 47) + "..."
        : value;
      message += `\n• ${key}: ${displayValue}`;
    }
  }

  return message;
}

/**
 * Normalizes option format to consistent label/value structure
 * Handles both string options and object options
 */
function normalizeOption(
  opt: string | { label: string; value: string },
): { label: string; value: string } {
  return typeof opt === "string" ? { label: opt, value: opt } : opt;
}

/**
 * Collects text field value using input box
 */
async function collectTextFieldValue(
  field: BlockStepField,
): Promise<string | undefined> {
  const label = field.text || field.key;
  const prompt = field.hint || `Enter value for ${label}`;
  const defaultValue =
    typeof field.default === "string" ? field.default : "";
  const value = await vscode.window.showInputBox({
    prompt,
    value: defaultValue,
    ignoreFocusOut: true,
    validateInput: field.format
      ? (input) => {
          const regex = new RegExp(`^${field.format}$`);
          if (!regex.test(input)) {
            return `Value must match pattern: ${field.format}`;
          }
          return null;
        }
      : field.required !== false
      ? (input) => {
          if (!input.trim()) {
            return `${label} is required`;
          }
          return null;
        }
      : undefined,
  });

  // Handle required fields
  if (field.required !== false && !value) {
    vscode.window.showErrorMessage(
      `${label} is required. Unblock cancelled.`,
    );
    return undefined;
  }

  return value || defaultValue;
}

/**
 * Collects select field value using quick pick
 */
async function collectSelectFieldValue(
  field: BlockStepField,
): Promise<string | string[] | undefined> {
  if (!field.options || field.options.length === 0) {
    const fieldName = field.select || field.key;
    vscode.window.showErrorMessage(
      `Invalid block step: "${fieldName}" has no options configured. ` +
        `Please contact the pipeline administrators to fix this block step.`,
    );
    return undefined;
  }

  const label = field.select || field.key;
  const prompt = field.hint || `Select value for ${label}`;

  // Normalize options to consistent format
  const normalizedOptions = field.options.map(normalizeOption);

  // Handle multi-select
  if (field.multiple) {
    const selected = await vscode.window.showQuickPick(
      normalizedOptions.map((opt) => ({
        label: opt.label,
        value: opt.value,
        picked: field.default
          ? Array.isArray(field.default)
            ? field.default.includes(opt.value)
            : field.default === opt.value
          : false,
      })),
      {
        placeHolder: prompt,
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );

    if (!selected || selected.length === 0) {
      if (field.required !== false) {
        vscode.window.showErrorMessage(
          `${label} is required. Unblock cancelled.`,
        );
        return undefined;
      }
      return "";
    }

    // Return as array - API will convert to newline-delimited string
    return selected.map((item) => item.value);
  }

  // Handle single-select
  const selected = await vscode.window.showQuickPick(
    normalizedOptions.map((opt) => ({
      label: opt.label,
      value: opt.value,
      picked: typeof field.default === "string" && field.default === opt.value,
    })),
    {
      placeHolder: prompt,
      ignoreFocusOut: true,
    },
  );

  if (!selected) {
    if (field.required !== false) {
      vscode.window.showErrorMessage(
        `${label} is required. Unblock cancelled.`,
      );
      return undefined;
    }
    return typeof field.default === "string" ? field.default : "";
  }

  return selected.value;
}

/**
 * Collects a single field value based on field type
 */
async function collectSingleFieldValue(
  field: BlockStepField,
): Promise<string | string[] | undefined> {
  // Text field
  if (field.text !== undefined) {
    return collectTextFieldValue(field);
  }

  // Select field
  if (field.select !== undefined && field.options) {
    return collectSelectFieldValue(field);
  }

  return undefined;
}

/**
 * Collects values for all fields from the user
 * Returns undefined if user cancels
 */
async function collectFieldValues(
  fields: BlockStepField[],
): Promise<Record<string, string | string[]> | undefined> {
  const values: Record<string, string | string[]> = {};

  for (const field of fields) {
    const value = await collectSingleFieldValue(field);
    if (value === undefined) {
      // User cancelled
      return undefined;
    }
    values[field.key] = value;
  }

  return values;
}

export async function unblockBuild(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  // Check if build is blocked
  if (!node.build.blocked) {
    vscode.window.showInformationMessage(
      `Build #${node.build.number} is not blocked`,
    );
    return;
  }

  try {
    // Fetch build with jobs
    const build = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching jobs for build #${node.build.number}...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        return client.getBuild(
          node.orgSlug,
          node.pipeline.slug,
          node.build.number,
        );
      },
    );

    const jobs = build.jobs || [];

    // Filter for unblockable jobs
    // Manual jobs that haven't been unblocked yet (unblocked_at is null/undefined)
    // The unblocked_at field is the most reliable indicator - it's set during the
    // unblock transaction and persists permanently
    const unblockableJobs = jobs.filter(
      (job: Job) => job.type === "manual" && !job.unblocked_at,
    );

    if (unblockableJobs.length === 0) {
      vscode.window.showErrorMessage(
        `No unblockable jobs found in build #${node.build.number}`,
      );
      return;
    }

    // If multiple blocked jobs, show QuickPick for selection
    let selectedJob: Job;
    if (unblockableJobs.length > 1) {
      const selected = await vscode.window.showQuickPick(
        unblockableJobs.map((job: Job) => ({
          label: job.name || job.label || "Unnamed job",
          description: `State: ${job.state}`,
          job,
        })),
        {
          placeHolder: "Select a job to unblock",
          ignoreFocusOut: true,
        },
      );

      if (!selected) {
        return;
      }
      selectedJob = selected.job;
    } else {
      selectedJob = unblockableJobs[0];
    }

    // Collect field values if job has fields
    let fieldValues: Record<string, string | string[]> | undefined;
    if (selectedJob.fields && selectedJob.fields.length > 0) {
      fieldValues = await collectFieldValues(selectedJob.fields);
      if (!fieldValues) {
        // User cancelled field input
        return;
      }
    }

    // Show confirmation dialog
    const jobName = selectedJob.name || selectedJob.label || "Unnamed job";
    const confirmation = await vscode.window.showWarningMessage(
      buildConfirmationMessage(node.build.number, jobName, fieldValues),
      { modal: true },
      "Unblock",
    );

    if (confirmation !== "Unblock") {
      return;
    }

    // Execute unblock with progress indicator
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Unblocking job '${jobName}'...`,
        cancellable: false,
      },
      async () => {
        const client = new BuildkiteClient();
        await client.unblockJob(
          node.orgSlug,
          node.pipeline.slug,
          node.build.number,
          selectedJob.id,
          fieldValues,
        );
      },
    );

    vscode.window.showInformationMessage(
      `Job '${jobName}' in build #${node.build.number} has been unblocked`,
    );

    // Refresh the tree to show the updated build state
    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to unblock: ${error.message}`);
    }
  }
}

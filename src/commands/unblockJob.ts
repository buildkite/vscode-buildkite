import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { BlockStepField, TextStepField, SelectStepField, isTextStepField, isSelectStepField } from "../api/types";
import { JobNode } from "../treeViews/nodes/jobNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";

/**
 * Builds confirmation message with field summary
 */
function buildConfirmationMessage(
  jobName: string,
  buildNumber: number,
  fieldValues?: Record<string, string | string[]>,
): string {
  let message = `Job "${jobName}" in build #${buildNumber} is waiting on approval.`;

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
  field: TextStepField,
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
      : field.required === true
      ? (input) => {
          if (!input.trim()) {
            return `${label} is required`;
          }
          return null;
        }
      : undefined,
  });

  // Handle required fields
  if (field.required === true && !value) {
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
  field: SelectStepField,
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
      if (field.required === true) {
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
    if (field.required === true) {
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
  if (isTextStepField(field)) {
    return collectTextFieldValue(field);
  }

  if (isSelectStepField(field)) {
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

/**
 * Checks if a job can be unblocked
 */
function canUnblockJob(job: JobNode): boolean {
  return (
    job.job.type === "manual" &&
    job.job.unblockable === true &&
    !job.job.unblocked_at
  );
}

export async function unblockJob(node: JobNode): Promise<void> {
  if (!node || !(node instanceof JobNode)) {
    vscode.window.showErrorMessage("Invalid job node");
    return;
  }

  if (!canUnblockJob(node)) {
    vscode.window.showWarningMessage(
      `Cannot unblock job: Job must be a manual block step that hasn't been unblocked yet.`,
    );
    return;
  }

  const jobName = node.job.name || node.job.label || "Unnamed job";

  try {
    // Collect field values if job has fields
    let fieldValues: Record<string, string | string[]> | undefined;
    if (node.job.fields && node.job.fields.length > 0) {
      fieldValues = await collectFieldValues(node.job.fields);
      if (!fieldValues) {
        // User cancelled field input
        return;
      }
    }

    // Show confirmation dialog
    const confirmation = await vscode.window.showWarningMessage(
      buildConfirmationMessage(jobName, node.buildNumber, fieldValues),
      { modal: true },
      "Unblock",
    );

    if (confirmation !== "Unblock") {
      return;
    }

    // Execute unblock
    const client = new BuildkiteClient();
    await client.unblockJob(
      node.orgSlug,
      node.pipelineSlug,
      node.buildNumber,
      node.job.id,
      fieldValues,
    );

    vscode.window.showInformationMessage(
      `Job "${jobName}" has been unblocked`,
    );

    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to unblock job: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to unblock job: An unknown error occurred",
      );
    }
  }
}

import * as vscode from "vscode";
import { BuildkiteClient } from "../api/client";
import { Job } from "../api/types";
import { BuildNode } from "../treeViews/nodes/buildNode";
import { getPipelinesTreeProvider } from "../treeViews/treeViews";
import { BlockStepField, TextStepField, SelectStepField, isTextStepField, isSelectStepField } from "../api/types";

/**
 * Checks if a job can be unblocked
 */
function canUnblockJob(job: Job): boolean {
  return (
    job.type === "manual" &&
    job.unblockable === true &&
    !job.unblocked_at
  );
}

/**
 * Normalizes option format to consistent label/value structure
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

  const normalizedOptions = field.options.map(normalizeOption);

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

    return selected.map((item) => item.value);
  }

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
 */
async function collectFieldValues(
  fields: BlockStepField[],
): Promise<Record<string, string | string[]> | undefined> {
  const values: Record<string, string | string[]> = {};

  for (const field of fields) {
    const value = await collectSingleFieldValue(field);
    if (value === undefined) {
      return undefined;
    }
    values[field.key] = value;
  }

  return values;
}

/**
 * Unblocks the first unblockable job in a build
 */
export async function unblockBuild(node: BuildNode): Promise<void> {
  if (!node || !(node instanceof BuildNode)) {
    vscode.window.showErrorMessage("Invalid build node");
    return;
  }

  if (!node.build.blocked) {
    vscode.window.showWarningMessage(
      `Build #${node.build.number} is not blocked`,
    );
    return;
  }

  try {
    const client = new BuildkiteClient();

    const jobs = await client.getJobs(
      node.orgSlug,
      node.pipeline.slug,
      node.build.number,
    );

    const unblockableJob = jobs.find(canUnblockJob);

    if (!unblockableJob) {
      vscode.window.showWarningMessage(
        `No unblockable jobs found in build #${node.build.number}`,
      );
      return;
    }

    const jobName = unblockableJob.name || unblockableJob.label || "Unnamed job";

    let fieldValues: Record<string, string | string[]> | undefined;
    if (unblockableJob.fields && unblockableJob.fields.length > 0) {
      fieldValues = await collectFieldValues(unblockableJob.fields);
      if (!fieldValues) {
        return;
      }
    }

    let message = `Unblock "${jobName}" in build #${node.build.number}?`;
    if (fieldValues && Object.keys(fieldValues).length > 0) {
      message += "\n\nField values:";
      for (const [key, value] of Object.entries(fieldValues)) {
        const displayValue = Array.isArray(value)
          ? value.join(", ")
          : value.length > 50
          ? value.substring(0, 47) + "..."
          : value;
        message += `\n• ${key}: ${displayValue}`;
      }
    }

    const confirmation = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "Unblock",
    );

    if (confirmation !== "Unblock") {
      return;
    }

    // Normalize field values: convert arrays to newline-delimited strings
    const normalizedFields = fieldValues
      ? Object.entries(fieldValues).reduce((acc, [key, value]) => {
          acc[key] = Array.isArray(value) ? value.join("\n") : value;
          return acc;
        }, {} as Record<string, string>)
      : undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Unblocking "${jobName}"...`,
        cancellable: false,
      },
      async () => {
        await client.unblockJob(
          node.orgSlug,
          node.pipeline.slug,
          node.build.number,
          unblockableJob.id,
          normalizedFields,
        );
      },
    );

    vscode.window.showInformationMessage(
      `Job "${jobName}" has been unblocked`,
    );

    const treeProvider = getPipelinesTreeProvider();
    await treeProvider.refresh();
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Failed to unblock build: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(
        "Failed to unblock build: An unknown error occurred",
      );
    }
  }
}

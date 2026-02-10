import * as vscode from "vscode";
import { BlockStepField, TextStepField, SelectStepField, isTextStepField, isSelectStepField } from "../api/types";

const MAX_DISPLAY_LENGTH = 50;
const ELLIPSIS = "...";

export function buildConfirmationMessage(
  firstLine: string,
  fieldValues?: Record<string, string | string[]>,
): string {
  let message = firstLine;

  if (fieldValues && Object.keys(fieldValues).length > 0) {
    message += "\n\nField values:";
    for (const [key, value] of Object.entries(fieldValues)) {
      let displayValue: string;
      if (Array.isArray(value)) {
        displayValue = value.join(", ");
      } else if (value.length > MAX_DISPLAY_LENGTH) {
        displayValue = value.substring(0, MAX_DISPLAY_LENGTH - ELLIPSIS.length) + ELLIPSIS;
      } else {
        displayValue = value;
      }
      message += `\n• ${key}: ${displayValue}`;
    }
  }

  return message;
}

function normalizeOption(
  opt: string | { label: string; value: string },
): { label: string; value: string } {
  return typeof opt === "string" ? { label: opt, value: opt } : opt;
}

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

  return value !== undefined ? value : defaultValue;
}

async function collectSelectFieldValue(
  field: SelectStepField,
): Promise<string | string[] | undefined> {
  if (!field.options || field.options.length === 0) {
    vscode.window.showErrorMessage(
      `Block step "${field.select || field.key}" has no options available.`,
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

    if (!selected) {
      return undefined;
    }

    if (selected.length === 0) {
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
    return undefined;
  }

  return selected.value;
}

function collectSingleFieldValue(
  field: BlockStepField,
): Promise<string | string[] | undefined> {
  if (isTextStepField(field)) {
    return collectTextFieldValue(field);
  }

  if (isSelectStepField(field)) {
    return collectSelectFieldValue(field);
  }

  return Promise.resolve(undefined);
}

export async function collectFieldValues(
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

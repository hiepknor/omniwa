import type { SafeMetadataValue } from "@omniwa/errors";

import type { ClassifiedValue } from "./data-classification.js";

export type SafeLogFields = Readonly<Record<string, SafeMetadataValue>>;

export function redactValue(field: ClassifiedValue): SafeMetadataValue {
  switch (field.classification) {
    case "public":
    case "internal":
      return normalizeSafeValue(field.value);
    case "confidential":
      return "[redacted:confidential]";
    case "secret":
      return "[redacted:secret]";
  }
}

export function toSafeLogFields(fields: Record<string, ClassifiedValue>): SafeLogFields {
  const safeFields: Record<string, SafeMetadataValue> = {};

  for (const [key, field] of Object.entries(fields)) {
    safeFields[key] = redactValue(field);
  }

  return Object.freeze(safeFields);
}

function normalizeSafeValue(value: unknown): SafeMetadataValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return String(value);
}

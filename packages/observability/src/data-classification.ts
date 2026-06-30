export const dataClassifications = ["public", "internal", "confidential", "secret"] as const;

export type DataClassification = (typeof dataClassifications)[number];

export type ClassifiedValue = {
  readonly classification: DataClassification;
  readonly value: unknown;
};

export function classifyValue(value: unknown, classification: DataClassification): ClassifiedValue {
  return { classification, value };
}

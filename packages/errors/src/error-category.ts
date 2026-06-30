export const errorCategories = [
  "business",
  "validation",
  "authentication",
  "authorization",
  "infrastructure",
  "provider",
  "configuration",
  "security",
  "unexpected",
] as const;

export type ErrorCategory = (typeof errorCategories)[number];

export function isErrorCategory(value: string): value is ErrorCategory {
  return errorCategories.includes(value as ErrorCategory);
}

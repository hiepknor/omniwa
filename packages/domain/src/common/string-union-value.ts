export function createStringUnionValue<const TValues extends readonly string[]>(
  value: string,
  allowedValues: TValues,
  label: string,
): TValues[number] {
  if (!isStringUnionValue(value, allowedValues)) {
    throw new TypeError(`${label} must be one of ${allowedValues.join(", ")}.`);
  }

  return value;
}

export function isStringUnionValue<const TValues extends readonly string[]>(
  value: string,
  allowedValues: TValues,
): value is TValues[number] {
  return allowedValues.includes(value);
}

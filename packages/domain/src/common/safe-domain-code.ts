const safeDomainCodePattern = /^[a-z][a-z0-9_.-]*$/u;

export function createSafeDomainCode(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();

  if (!safeDomainCodePattern.test(normalized)) {
    throw new TypeError(`${label} must be a safe lowercase domain code.`);
  }

  return normalized;
}

export function isSafeDomainCode(value: string): boolean {
  return safeDomainCodePattern.test(value);
}

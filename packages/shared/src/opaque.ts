const opaqueBrand: unique symbol = Symbol("omniwa.opaque");

export type OpaqueString<Name extends string> = string & {
  readonly [opaqueBrand]: Name;
};

export function createOpaqueString<Name extends string>(
  value: string,
  label: Name,
): OpaqueString<Name> {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }

  return normalized as OpaqueString<Name>;
}

import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

export type DomainIdentity<Name extends string> = OpaqueString<Name>;

export function createDomainIdentity<Name extends string>(
  value: string,
  label: Name,
): DomainIdentity<Name> {
  const normalized = value.trim();

  if (!/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    throw new TypeError(`${label} must be an opaque safe token.`);
  }

  return createOpaqueString(normalized, label);
}

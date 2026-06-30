import type { Result } from "@omniwa/shared";
import { createOpaqueString, type OpaqueString } from "@omniwa/shared";
import type { OmniwaError } from "@omniwa/errors";

export type SecretName = OpaqueString<"SecretName">;

export type SecretPurpose = OpaqueString<"SecretPurpose">;

export type SecretDescriptor = {
  readonly name: SecretName;
  readonly purpose: SecretPurpose;
};

export class SecretValue {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static fromString(value: string): SecretValue {
    if (value.length === 0) {
      throw new TypeError("SecretValue must not be empty.");
    }

    return new SecretValue(value);
  }

  revealForUse(): string {
    return this.#value;
  }

  toJSON(): string {
    return "[secret]";
  }

  toString(): string {
    return "[secret]";
  }
}

export interface SecretProvider {
  readSecret(descriptor: SecretDescriptor): Promise<Result<SecretValue, OmniwaError>>;
}

export function createSecretName(value: string): SecretName {
  return createOpaqueString(value, "SecretName");
}

export function createSecretPurpose(value: string): SecretPurpose {
  return createOpaqueString(value, "SecretPurpose");
}

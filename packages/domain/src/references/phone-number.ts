import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

export type PhoneNumber = OpaqueString<"PhoneNumber">;

export function createPhoneNumber(value: string): PhoneNumber {
  const normalized = value.trim().replace(/[()\-\s]/gu, "");

  if (!/^\+[1-9]\d{6,14}$/u.test(normalized)) {
    throw new TypeError("PhoneNumber must be an E.164-like confidential reference.");
  }

  return createOpaqueString(normalized, "PhoneNumber");
}

export function redactPhoneNumber(value: PhoneNumber): string {
  void value;
  return "[confidential:phone-number]";
}

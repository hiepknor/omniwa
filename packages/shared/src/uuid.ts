import { randomUUID } from "node:crypto";

import { createOpaqueString, type OpaqueString } from "./opaque.js";

export type Uuid = OpaqueString<"Uuid">;

export interface UUIDGenerator {
  random(): Uuid;
}

export function createUuid(value: string): Uuid {
  const normalized = value.trim().toLowerCase();

  if (!isUuid(normalized)) {
    throw new TypeError("Uuid must be an RFC 4122 UUID string.");
  }

  return createOpaqueString(normalized, "Uuid");
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

export const cryptoUUIDGenerator: UUIDGenerator = {
  random: () => createUuid(randomUUID()),
};

import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

export type ConfigurationKey = OpaqueString<"ConfigurationKey">;

export function createConfigurationKey(value: string): ConfigurationKey {
  return createOpaqueString(value, "ConfigurationKey");
}

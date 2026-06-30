import type { Result } from "@omniwa/shared";
import type { OmniwaError } from "@omniwa/errors";

import type { ConfigurationKey } from "./configuration-key.js";

export type ConfigurationValue = string | number | boolean;

export interface ConfigurationSnapshot {
  get(key: ConfigurationKey): ConfigurationValue | undefined;
  require(key: ConfigurationKey): Result<ConfigurationValue, OmniwaError>;
}

export interface ConfigurationProvider {
  load(): Promise<Result<ConfigurationSnapshot, OmniwaError>>;
}

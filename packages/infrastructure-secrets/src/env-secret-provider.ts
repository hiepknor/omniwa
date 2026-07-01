import { SecretValue, type SecretDescriptor, type SecretProvider } from "@omniwa/config";
import { fail, type OmniwaError, succeed } from "@omniwa/errors";
import type { Result } from "@omniwa/shared";

export type EnvSecretProviderOptions = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
}>;

export class EnvSecretProvider implements SecretProvider {
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(options: EnvSecretProviderOptions = {}) {
    this.env = options.env ?? process.env;
  }

  readSecret(descriptor: SecretDescriptor): Promise<Result<SecretValue, OmniwaError>> {
    const rawValue = this.env[String(descriptor.name)]?.trim();

    if (rawValue === undefined || rawValue.length === 0) {
      return Promise.resolve(
        fail({
          category: "configuration",
          code: "secret_not_found",
          message: "Required secret is not available.",
          retryable: false,
          metadata: {
            secretName: String(descriptor.name),
            secretPurpose: String(descriptor.purpose),
          },
        }),
      );
    }

    try {
      return Promise.resolve(succeed(SecretValue.fromString(rawValue)));
    } catch (error) {
      return Promise.resolve(
        fail({
          category: "configuration",
          code: "invalid_secret_value",
          message: "Required secret value is invalid.",
          retryable: false,
          metadata: {
            secretName: String(descriptor.name),
            secretPurpose: String(descriptor.purpose),
          },
          cause: error,
        }),
      );
    }
  }
}

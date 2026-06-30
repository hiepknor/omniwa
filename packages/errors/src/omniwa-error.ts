import type { Result } from "@omniwa/shared";
import { err, ok } from "@omniwa/shared";

import type { ErrorCategory } from "./error-category.js";
import type { SafeErrorMetadata } from "./safe-metadata.js";

export type OmniwaErrorOptions = {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly metadata?: SafeErrorMetadata;
  readonly cause?: unknown;
};

export type SafeErrorShape = {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly metadata: SafeErrorMetadata;
};

export class OmniwaError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly retryable: boolean;
  readonly metadata: SafeErrorMetadata;

  constructor(options: OmniwaErrorOptions) {
    if (options.cause === undefined) {
      super(options.message);
    } else {
      super(options.message, { cause: options.cause });
    }

    this.name = "OmniwaError";
    this.category = options.category;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.metadata = options.metadata ?? {};
  }

  toSafeShape(): SafeErrorShape {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      metadata: this.metadata,
    };
  }
}

export function fail<T = never>(options: OmniwaErrorOptions): Result<T, OmniwaError> {
  return err(new OmniwaError(options));
}

export function succeed<T>(value: T): Result<T, OmniwaError> {
  return ok(value);
}

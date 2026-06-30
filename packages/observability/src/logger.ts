import type { CorrelationId, RequestId, TraceId } from "@omniwa/shared";
import type { ErrorCategory, SafeErrorMetadata } from "@omniwa/errors";

import type { SafeLogFields } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  readonly correlationId?: CorrelationId;
  readonly requestId?: RequestId;
  readonly traceId?: TraceId;
  readonly runtimeRole?: string;
  readonly failureCategory?: ErrorCategory;
};

export type LogEntry = {
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: LogContext;
  readonly fields?: SafeLogFields;
  readonly error?: SafeErrorMetadata;
};

export interface StructuredLogger {
  write(entry: LogEntry): void;
}

export const nullLogger: StructuredLogger = {
  write: () => undefined,
};

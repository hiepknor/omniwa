import type { LogEntry, StructuredLogger } from "@omniwa/observability";

export type StructuredLogLineSink = Readonly<{
  writeLine(line: string): void;
}>;

export type JsonLineStructuredLogBackendOptions = Readonly<{
  sink: StructuredLogLineSink;
}>;

export class JsonLineStructuredLogBackendAdapter implements StructuredLogger {
  private readonly sink: StructuredLogLineSink;

  constructor(options: JsonLineStructuredLogBackendOptions) {
    this.sink = options.sink;
  }

  write(entry: LogEntry): void {
    this.sink.writeLine(`${JSON.stringify(toPublicLogRecord(entry))}\n`);
  }
}

export function toPublicLogRecord(entry: LogEntry): Readonly<Record<string, unknown>> {
  return Object.freeze({
    level: entry.level,
    message: entry.message,
    ...optional(
      "context",
      entry.context === undefined ? undefined : Object.freeze({ ...entry.context }),
    ),
    ...optional(
      "fields",
      entry.fields === undefined ? undefined : Object.freeze({ ...entry.fields }),
    ),
    ...optional("error", entry.error === undefined ? undefined : Object.freeze({ ...entry.error })),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

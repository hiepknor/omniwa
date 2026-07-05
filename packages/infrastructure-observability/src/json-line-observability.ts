import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { MetricPoint, MetricRecorder } from "@omniwa/observability";

import type { StructuredLogLineSink } from "./structured-log-backend.js";

export type JsonLineFileSinkOptions = Readonly<{
  filePath: string;
}>;

export type JsonLineMetricRecorderOptions = Readonly<{
  sink: StructuredLogLineSink;
}>;

export class JsonLineFileSink implements StructuredLogLineSink {
  private readonly filePath: string;

  constructor(options: JsonLineFileSinkOptions) {
    this.filePath = options.filePath;
  }

  writeLine(line: string): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, line, "utf8");
  }
}

export class JsonLineMetricRecorder implements MetricRecorder {
  private readonly sink: StructuredLogLineSink;

  constructor(options: JsonLineMetricRecorderOptions) {
    this.sink = options.sink;
  }

  recordMetric(point: MetricPoint): void {
    this.sink.writeLine(`${JSON.stringify(toPublicMetricRecord(point))}\n`);
  }
}

export function toPublicMetricRecord(point: MetricPoint): Readonly<Record<string, unknown>> {
  return Object.freeze({
    name: point.name,
    kind: point.kind,
    value: point.value,
    runtimeRole: point.runtimeRole,
    ...optional("unit", point.unit),
    ...optional(
      "labels",
      point.labels === undefined ? undefined : Object.freeze({ ...point.labels }),
    ),
    ...optional(
      "context",
      point.context === undefined ? undefined : Object.freeze({ ...point.context }),
    ),
    ...optional("observedAtEpochMilliseconds", point.observedAtEpochMilliseconds),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

import type { MetricPoint } from "@omniwa/observability";
import type { SafeMetadataValue } from "@omniwa/errors";

export type MetricsExportSnapshot = Readonly<{
  contentType: "text/plain; version=0.0.4; charset=utf-8";
  body: string;
}>;

export function exportMetricsText(points: readonly MetricPoint[]): MetricsExportSnapshot {
  const lines = points.flatMap((point) => metricPointLines(point));

  return Object.freeze({
    contentType: "text/plain; version=0.0.4; charset=utf-8",
    body: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
  });
}

function metricPointLines(point: MetricPoint): readonly string[] {
  const metricName = normalizeMetricName(point.name);
  const labels = labelsFor(point);

  return Object.freeze([
    `# TYPE ${metricName} ${prometheusKind(point.kind)}`,
    `${metricName}${labels} ${point.value}`,
  ]);
}

function labelsFor(point: MetricPoint): string {
  const labels: Record<string, SafeMetadataValue> = {
    runtime_role: point.runtimeRole,
    ...(point.labels ?? {}),
  };
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return "";
  }

  return `{${entries
    .map(([key, value]) => `${normalizeLabelName(key)}="${escapeLabelValue(value)}"`)
    .join(",")}}`;
}

function prometheusKind(kind: MetricPoint["kind"]): string {
  switch (kind) {
    case "counter":
      return "counter";
    case "gauge":
      return "gauge";
    case "histogram":
      return "histogram";
  }
}

function normalizeMetricName(value: string): string {
  return value.replaceAll(".", "_").replaceAll("-", "_");
}

function normalizeLabelName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/gu, "_");
}

function escapeLabelValue(value: SafeMetadataValue): string {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

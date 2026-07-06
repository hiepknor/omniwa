import {
  InMemoryObservabilityRuntime,
  exportMetricsText,
} from "@omniwa/infrastructure-observability";
import { classifyValue, createCatalogMetricPoint, toSafeLogFields } from "@omniwa/observability";

export type MetricsRuntimeSmokeSnapshot = Readonly<{
  metricCount: number;
  contentType: string;
  body: string;
}>;

export function createMetricsRuntimeSmokeSnapshot(): MetricsRuntimeSmokeSnapshot {
  const runtime = new InMemoryObservabilityRuntime();

  runtime.recordMetric(
    createCatalogMetricPoint("api.request.latency", {
      value: 125,
      labels: toSafeLogFields({
        method: classifyValue("GET", "public"),
        route: classifyValue("/v1/health/readiness", "public"),
        outcome: classifyValue("success", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("queue.work.latency", {
      value: 250,
      labels: toSafeLogFields({
        work_type: classifyValue("webhook_delivery", "public"),
        outcome: classifyValue("completed", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("queue.backlog.depth", {
      value: 2,
      labels: toSafeLogFields({
        work_type: classifyValue("outbound_message", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("queue.backlog.oldest_pending_age", {
      value: 1500,
      labels: toSafeLogFields({
        work_type: classifyValue("outbound_message", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("provider.connection.state", {
      value: 1,
      labels: toSafeLogFields({
        state: classifyValue("connected", "public"),
        provider_family: classifyValue("whatsapp_web", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("webhook.delivery.success.total", {
      value: 1,
      labels: toSafeLogFields({
        outcome: classifyValue("delivered", "public"),
        receiver_category: classifyValue("healthy_receiver", "internal"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("worker.utilization.ratio", {
      value: 0.5,
      labels: toSafeLogFields({
        worker_type: classifyValue("default", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("event_stream.errors.total", {
      value: 0,
      labels: toSafeLogFields({
        source: classifyValue("sse", "public"),
        reason_code: classifyValue("none", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("api.rate_limit.bucket.count", {
      value: 3,
      labels: toSafeLogFields({
        endpoint_class: classifyValue("read", "public"),
        scope_kind: classifyValue("instance", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("api.rate_limit.bucket.remaining", {
      value: 7,
      labels: toSafeLogFields({
        endpoint_class: classifyValue("read", "public"),
        scope_kind: classifyValue("instance", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("api.rate_limit.bucket.limit", {
      value: 10,
      labels: toSafeLogFields({
        endpoint_class: classifyValue("read", "public"),
        scope_kind: classifyValue("instance", "public"),
      }),
    }),
  );
  runtime.recordMetric(
    createCatalogMetricPoint("eventlog.outbox.records", {
      value: 0,
      labels: toSafeLogFields({
        status: classifyValue("pending", "public"),
      }),
    }),
  );

  const exported = exportMetricsText(runtime.snapshot().metrics);

  return Object.freeze({
    metricCount: runtime.snapshot().metrics.length,
    contentType: exported.contentType,
    body: exported.body,
  });
}

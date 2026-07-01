import { describe, expect, it } from "vitest";

import { createMetricsRuntimeSmokeSnapshot } from "./index.js";

describe("metrics runtime smoke", () => {
  it("exports PR-13 required production metrics without unsafe identifiers", () => {
    const snapshot = createMetricsRuntimeSmokeSnapshot();

    expect(snapshot.metricCount).toBe(6);
    expect(snapshot.contentType).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(snapshot.body).toContain("api_request_latency");
    expect(snapshot.body).toContain("queue_work_latency");
    expect(snapshot.body).toContain("provider_connection_state");
    expect(snapshot.body).toContain("webhook_delivery_success_total");
    expect(snapshot.body).toContain("worker_utilization_ratio");
    expect(snapshot.body).toContain("event_stream_errors_total");
    expect(snapshot.body).not.toContain("synthetic-secret");
    expect(snapshot.body).not.toContain("inst_");
  });
});

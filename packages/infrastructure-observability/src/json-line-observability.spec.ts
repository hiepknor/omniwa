import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyValue, createMetricPoint, toSafeLogFields } from "@omniwa/observability";
import { describe, expect, it } from "vitest";

import { JsonLineFileSink, JsonLineMetricRecorder } from "./json-line-observability.js";

describe("JsonLineMetricRecorder", () => {
  it("writes safe JSON lines without raw secret or confidential values", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-json-line-observability-"));
    const filePath = join(directory, "metrics.jsonl");

    try {
      const recorder = new JsonLineMetricRecorder({
        sink: new JsonLineFileSink({ filePath }),
      });

      recorder.recordMetric(
        createMetricPoint({
          name: "webhook_dispatcher.dispatch.total",
          kind: "counter",
          value: 1,
          runtimeRole: "webhook",
          labels: toSafeLogFields({
            outcome: classifyValue("delivered", "internal"),
            signingSecret: classifyValue("raw-webhook-secret", "secret"),
            targetUrl: classifyValue("https://receiver.example.test/hook", "confidential"),
          }),
        }),
      );

      const content = readFileSync(filePath, "utf8");
      expect(content.trim()).toMatch(/"name":"webhook_dispatcher\.dispatch\.total"/u);
      expect(content).toContain("[redacted:secret]");
      expect(content).toContain("[redacted:confidential]");
      expect(content).not.toContain("raw-webhook-secret");
      expect(content).not.toContain("receiver.example.test");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApplicationPortResult, EventOutboxRecord } from "@omniwa/application";
import {
  createInMemoryEventLogStore,
  type EventOutboxPublisher,
} from "@omniwa/infrastructure-persistence";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import { ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  createBackgroundRuntimeComposition,
  readBackgroundEventLogBackend,
  readBackgroundRuntimeProfile,
} from "./runtime-composition.js";

describe("background runtime composition", () => {
  it("composes a local background outbox loop with safe disabled publisher fallback", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_background_local"));
    const composition = createBackgroundRuntimeComposition(
      {
        OMNIWA_BACKGROUND_RUNTIME_PROFILE: "local",
      } as NodeJS.ProcessEnv,
      {
        eventLog,
      },
    );

    const result = await composition.loop.runOnce();

    expect(composition.profile).toBe("local");
    expect(composition.eventLogBackend).toBe("in-memory");
    expect(result.outbox).toEqual({
      status: "completed",
      attempted: 1,
      published: 0,
      failed: 1,
    });
    expect(eventLog.listOutbox({ status: "pending" })).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ eventId: "evt_background_local" })],
    });
    expect(JSON.stringify(result)).not.toContain("evt_background_local");
  });

  it("fails closed for production without PostgreSQL backend, publisher, and metric recorder", () => {
    expect(() =>
      createBackgroundRuntimeComposition({
        OMNIWA_BACKGROUND_RUNTIME_PROFILE: "production",
      } as NodeJS.ProcessEnv),
    ).toThrow(
      /Missing: OMNIWA_BACKGROUND_EVENT_LOG_BACKEND=postgresql, OMNIWA_POSTGRES_DATABASE_URL, event outbox publisher adapter, event outbox metric recorder adapter/u,
    );
  });

  it("composes production with PostgreSQL backend and injected publisher/metrics", () => {
    const composition = createBackgroundRuntimeComposition(
      {
        OMNIWA_BACKGROUND_RUNTIME_PROFILE: "production",
        OMNIWA_BACKGROUND_EVENT_LOG_BACKEND: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:secret@postgres:5432/omniwa",
      } as NodeJS.ProcessEnv,
      {
        eventLog: createInMemoryEventLogStore(),
        publisher: new RecordingPublisher(),
        metricRecorder: new CapturingMetricRecorder(),
      },
    );

    expect(composition.profile).toBe("production");
    expect(composition.eventLogBackend).toBe("postgresql");
    expect(composition.loop.snapshot()).toEqual({
      running: false,
      intervalMilliseconds: 5_000,
    });
  });

  it("rejects shared JSONL publisher and metric paths for production composition", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-background-runtime-"));
    const sharedPath = join(directory, "shared.jsonl");

    try {
      expect(() =>
        createBackgroundRuntimeComposition({
          OMNIWA_BACKGROUND_RUNTIME_PROFILE: "production",
          OMNIWA_BACKGROUND_EVENT_LOG_BACKEND: "postgresql",
          OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:secret@postgres:5432/omniwa",
          OMNIWA_EVENT_OUTBOX_PUBLISHER_JSONL_PATH: sharedPath,
          OMNIWA_EVENT_OUTBOX_METRICS_JSONL_PATH: sharedPath,
        } as NodeJS.ProcessEnv),
      ).toThrow(/distinct event outbox publisher and metric JSONL paths/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("wires env-configured JSONL publisher and metrics for production", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-background-runtime-"));

    try {
      const eventLog = createInMemoryEventLogStore();
      eventLog.appendEvent(event("evt_background_jsonl"));
      const composition = createBackgroundRuntimeComposition(
        {
          OMNIWA_BACKGROUND_RUNTIME_PROFILE: "production",
          OMNIWA_BACKGROUND_EVENT_LOG_BACKEND: "postgresql",
          OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:secret@postgres:5432/omniwa",
          OMNIWA_EVENT_OUTBOX_PUBLISHER_JSONL_PATH: join(directory, "publisher.jsonl"),
          OMNIWA_EVENT_OUTBOX_METRICS_JSONL_PATH: join(directory, "metrics.jsonl"),
        } as NodeJS.ProcessEnv,
        {
          eventLog,
        },
      );

      const result = await composition.loop.runOnce();

      expect(result.outbox).toEqual({
        status: "completed",
        attempted: 1,
        published: 1,
        failed: 0,
      });
      expect(result.metrics).toEqual({
        status: "recorded",
        recorded: 2,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads profile and EventLog backend from env with safe defaults", () => {
    expect(readBackgroundRuntimeProfile({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(
      "production",
    );
    expect(
      readBackgroundEventLogBackend({
        OMNIWA_EVENT_LOG_BACKEND: "postgresql",
      } as NodeJS.ProcessEnv),
    ).toBe("postgresql");
    expect(readBackgroundEventLogBackend({} as NodeJS.ProcessEnv)).toBe("in-memory");
  });
});

class RecordingPublisher implements EventOutboxPublisher {
  publish(record: EventOutboxRecord): ApplicationPortResult<{ eventId: string; accepted: true }> {
    return ok(
      Object.freeze({
        eventId: record.eventId,
        accepted: true,
      }),
    );
  }
}

class CapturingMetricRecorder implements MetricRecorder {
  readonly points: MetricPoint[] = [];

  recordMetric(point: MetricPoint): void {
    this.points.push(point);
  }
}

function event(id: string) {
  return {
    id,
    type: "message.accepted.v1",
    timestamp: "2026-07-05T00:00:00.000Z",
    dataClassification: "internal" as const,
    source: "background_runtime_composition_test",
    resourceRef: "msg_background_runtime",
    payload: {
      aggregateId: "msg_background_runtime",
      aggregateType: "Message",
      domainEventName: "MessageAccepted",
      eventIndex: 0,
    },
  };
}

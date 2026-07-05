import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { AsyncEventOutboxPort, EventOutboxPort } from "@omniwa/application";
import {
  JsonLineEventOutboxPublisher,
  JsonLineFileSink,
  JsonLineMetricRecorder,
} from "@omniwa/infrastructure-observability";
import {
  createDurableJsonEventLogStore,
  createInMemoryEventLogStore,
  createPostgresqlConnectionPool,
  EventOutboxConsumer,
  PostgresqlEventLogStore,
  type EventOutboxPublisher,
  type PostgresqlConnection,
} from "@omniwa/infrastructure-persistence";
import type { MetricRecorder } from "@omniwa/observability";

import {
  EventOutboxRuntimeLoop,
  readEventOutboxRuntimeLoopIntervalMilliseconds,
} from "./event-outbox-runtime-loop.js";

export const backgroundRuntimeProfiles = ["local", "test", "production"] as const;

export type BackgroundRuntimeProfile = (typeof backgroundRuntimeProfiles)[number];

export const backgroundEventLogBackends = ["in-memory", "durable-json", "postgresql"] as const;

export type BackgroundEventLogBackend = (typeof backgroundEventLogBackends)[number];

export type BackgroundRuntimeComposition = Readonly<{
  profile: BackgroundRuntimeProfile;
  eventLogBackend: BackgroundEventLogBackend;
  loop: EventOutboxRuntimeLoop;
  dispose?: () => Promise<void>;
}>;

export type BackgroundRuntimeCompositionAdapterOptions = Readonly<{
  eventLog?: EventOutboxPort | AsyncEventOutboxPort;
  publisher?: EventOutboxPublisher;
  metricRecorder?: MetricRecorder;
  postgresConnection?: PostgresqlConnection;
}>;

type BackgroundEventLogComposition = Readonly<{
  eventLog: EventOutboxPort | AsyncEventOutboxPort;
  dispose?: () => Promise<void>;
}>;

export function createBackgroundRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
  adapters: BackgroundRuntimeCompositionAdapterOptions = {},
): BackgroundRuntimeComposition {
  const profile = readBackgroundRuntimeProfile(env);
  const eventLogBackend = readBackgroundEventLogBackend(env);
  const publisher = adapters.publisher ?? createJsonLineEventOutboxPublisherFromEnv(env);
  const metricRecorder = adapters.metricRecorder ?? createJsonLineMetricRecorderFromEnv(env);

  assertBackgroundRuntimeProfileIsComposable({
    profile,
    eventLogBackend,
    postgresDatabaseUrl: env.OMNIWA_POSTGRES_DATABASE_URL,
    hasPublisher: publisher !== undefined,
    hasMetricRecorder: metricRecorder !== undefined,
    publisherJsonlPath: readOptionalStringEnv(env, "OMNIWA_EVENT_OUTBOX_PUBLISHER_JSONL_PATH"),
    metricsJsonlPath: readOptionalStringEnv(env, "OMNIWA_EVENT_OUTBOX_METRICS_JSONL_PATH"),
  });

  const eventLogComposition =
    adapters.eventLog === undefined
      ? createBackgroundEventLog(env, eventLogBackend, adapters)
      : Object.freeze({
          eventLog: adapters.eventLog,
          ...optional(
            "dispose",
            adapters.postgresConnection?.end?.bind(adapters.postgresConnection),
          ),
        });
  const eventLog = eventLogComposition.eventLog;
  const consumer = new EventOutboxConsumer({
    eventLog,
    publisher: publisher ?? new DisabledEventOutboxPublisher(),
  });
  const loop = new EventOutboxRuntimeLoop({
    consumer,
    eventLog,
    ...optional("metricRecorder", metricRecorder),
    intervalMilliseconds: readEventOutboxRuntimeLoopIntervalMilliseconds(env),
  });

  return Object.freeze({
    profile,
    eventLogBackend,
    loop,
    ...optional("dispose", eventLogComposition.dispose),
  });
}

export function readBackgroundRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): BackgroundRuntimeProfile {
  const value = env.OMNIWA_BACKGROUND_RUNTIME_PROFILE?.trim() ?? env.NODE_ENV?.trim();

  switch (value) {
    case "production":
      return "production";
    case "test":
      return "test";
    case "local":
    case "development":
    case undefined:
    case "":
      return "local";
    default:
      throw new Error(`Unsupported OmniWA Background runtime profile: ${value}`);
  }
}

export function readBackgroundEventLogBackend(
  env: NodeJS.ProcessEnv = process.env,
): BackgroundEventLogBackend {
  const value =
    env.OMNIWA_BACKGROUND_EVENT_LOG_BACKEND?.trim() ?? env.OMNIWA_EVENT_LOG_BACKEND?.trim();

  switch (value) {
    case "postgresql":
      return "postgresql";
    case "durable-json":
      return "durable-json";
    case "in-memory":
    case undefined:
    case "":
      return "in-memory";
    default:
      throw new Error(`Unsupported OmniWA Background EventLog backend: ${value}`);
  }
}

function createBackgroundEventLog(
  env: NodeJS.ProcessEnv,
  backend: BackgroundEventLogBackend,
  adapters: BackgroundRuntimeCompositionAdapterOptions,
): BackgroundEventLogComposition {
  switch (backend) {
    case "in-memory":
      return Object.freeze({
        eventLog: createInMemoryEventLogStore(),
      });
    case "durable-json": {
      const path = readOptionalStringEnv(env, "OMNIWA_EVENT_LOG_PATH");

      if (path === undefined) {
        throw new Error("OMNIWA_EVENT_LOG_PATH is required for durable-json background EventLog.");
      }

      return Object.freeze({
        eventLog: createDurableJsonEventLogStore(path),
      });
    }
    case "postgresql": {
      const databaseUrl = readOptionalStringEnv(env, "OMNIWA_POSTGRES_DATABASE_URL");

      if (databaseUrl === undefined && adapters.postgresConnection === undefined) {
        throw new Error("OMNIWA_POSTGRES_DATABASE_URL is required for PostgreSQL EventLog.");
      }

      const connection =
        adapters.postgresConnection ?? createPostgresqlConnectionPool(databaseUrl ?? "");

      return Object.freeze({
        eventLog: new PostgresqlEventLogStore(connection),
        ...optional("dispose", connection.end?.bind(connection)),
      });
    }
  }
}

function createJsonLineEventOutboxPublisherFromEnv(
  env: NodeJS.ProcessEnv,
): EventOutboxPublisher | undefined {
  const filePath = readOptionalStringEnv(env, "OMNIWA_EVENT_OUTBOX_PUBLISHER_JSONL_PATH");

  return filePath === undefined
    ? undefined
    : new JsonLineEventOutboxPublisher({
        sink: new JsonLineFileSink({ filePath }),
      });
}

function createJsonLineMetricRecorderFromEnv(env: NodeJS.ProcessEnv): MetricRecorder | undefined {
  const filePath = readOptionalStringEnv(env, "OMNIWA_EVENT_OUTBOX_METRICS_JSONL_PATH");

  return filePath === undefined
    ? undefined
    : new JsonLineMetricRecorder({
        sink: new JsonLineFileSink({ filePath }),
      });
}

function assertBackgroundRuntimeProfileIsComposable(input: {
  profile: BackgroundRuntimeProfile;
  eventLogBackend: BackgroundEventLogBackend;
  postgresDatabaseUrl: string | undefined;
  hasPublisher: boolean;
  hasMetricRecorder: boolean;
  publisherJsonlPath: string | undefined;
  metricsJsonlPath: string | undefined;
}): void {
  if (input.profile !== "production") {
    return;
  }

  const missing: string[] = [];

  if (input.eventLogBackend !== "postgresql") {
    missing.push("OMNIWA_BACKGROUND_EVENT_LOG_BACKEND=postgresql");
  }

  if (readOptionalLiteral(input.postgresDatabaseUrl) === undefined) {
    missing.push("OMNIWA_POSTGRES_DATABASE_URL");
  }

  if (!input.hasPublisher) {
    missing.push("event outbox publisher adapter");
  }

  if (!input.hasMetricRecorder) {
    missing.push("event outbox metric recorder adapter");
  }

  if (
    input.publisherJsonlPath !== undefined &&
    input.metricsJsonlPath !== undefined &&
    resolve(input.publisherJsonlPath) === resolve(input.metricsJsonlPath)
  ) {
    missing.push("distinct event outbox publisher and metric JSONL paths");
  }

  if (input.publisherJsonlPath !== undefined) {
    assertJsonLineTargetPathWritable(
      input.publisherJsonlPath,
      "writable event outbox publisher JSONL path",
      missing,
    );
  }

  if (input.metricsJsonlPath !== undefined) {
    assertJsonLineTargetPathWritable(
      input.metricsJsonlPath,
      "writable event outbox metric JSONL path",
      missing,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `OmniWA Background production profile is not composable. Missing: ${missing.join(", ")}.`,
    );
  }
}

function assertJsonLineTargetPathWritable(
  filePath: string,
  safeRequirementLabel: string,
  missing: string[],
): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const descriptor = openSync(filePath, "a");
    closeSync(descriptor);
  } catch {
    missing.push(safeRequirementLabel);
  }
}

function readOptionalStringEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return readOptionalLiteral(env[name]);
}

function readOptionalLiteral(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

class DisabledEventOutboxPublisher implements EventOutboxPublisher {
  publish(): ReturnType<EventOutboxPublisher["publish"]> {
    return {
      ok: false,
      error: Object.freeze({
        category: "unavailable",
        code: "event_outbox_publisher_not_configured",
        message: "EventLog outbox publisher is not configured.",
        retryable: true,
        ownerContext: "observability",
      }),
    };
  }
}

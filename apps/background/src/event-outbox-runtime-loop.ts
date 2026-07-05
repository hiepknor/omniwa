import {
  type ApplicationPortContext,
  type ApplicationPortResult,
  type AsyncEventOutboxPort,
  type EventOutboxPort,
} from "@omniwa/application";
import { recordEventOutboxBacklogMetrics } from "@omniwa/infrastructure-observability";
import type {
  EventOutboxConsumer,
  EventOutboxConsumerRunResult,
} from "@omniwa/infrastructure-persistence";
import type { MetricRecorder } from "@omniwa/observability";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  systemClock,
  type Clock,
} from "@omniwa/shared";

export type EventOutboxRuntimeLoopConsumer = Pick<EventOutboxConsumer, "drainPending">;

export type EventOutboxRuntimeLoopContextFactory = () => ApplicationPortContext;

export type EventOutboxRuntimeLoopOptions = Readonly<{
  consumer: EventOutboxRuntimeLoopConsumer;
  eventLog: EventOutboxPort | AsyncEventOutboxPort;
  metricRecorder?: MetricRecorder;
  contextFactory?: EventOutboxRuntimeLoopContextFactory;
  intervalMilliseconds?: number;
  clock?: Pick<Clock, "epochMilliseconds">;
  onError?: (error: unknown) => void;
}>;

export type EventOutboxRuntimeLoopOutboxSummary = Readonly<{
  status: "completed" | "failed";
  attempted: number;
  published: number;
  failed: number;
  failureCode?: string;
}>;

export type EventOutboxRuntimeLoopMetricSummary = Readonly<{
  status: "recorded" | "skipped" | "failed";
  recorded: number;
  failureCode?: string;
}>;

export type EventOutboxRuntimeLoopTickResult = Readonly<{
  outbox: EventOutboxRuntimeLoopOutboxSummary;
  metrics: EventOutboxRuntimeLoopMetricSummary;
  durationMilliseconds: number;
}>;

const defaultEventOutboxRuntimeLoopIntervalMilliseconds = 5_000;

export class EventOutboxRuntimeLoop {
  private readonly consumer: EventOutboxRuntimeLoopConsumer;
  private readonly eventLog: EventOutboxPort | AsyncEventOutboxPort;
  private readonly metricRecorder: MetricRecorder | undefined;
  private readonly contextFactory: EventOutboxRuntimeLoopContextFactory;
  private readonly intervalMilliseconds: number;
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly onError: ((error: unknown) => void) | undefined;

  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(options: EventOutboxRuntimeLoopOptions) {
    this.consumer = options.consumer;
    this.eventLog = options.eventLog;
    this.metricRecorder = options.metricRecorder;
    this.clock = options.clock ?? systemClock;
    this.contextFactory =
      options.contextFactory ?? (() => createEventOutboxRuntimeContext(this.clock));
    this.intervalMilliseconds =
      options.intervalMilliseconds ?? defaultEventOutboxRuntimeLoopIntervalMilliseconds;
    this.onError = options.onError;
    assertPositiveInteger(this.intervalMilliseconds, "intervalMilliseconds");
  }

  async runOnce(): Promise<EventOutboxRuntimeLoopTickResult> {
    const startedAt = this.clock.epochMilliseconds();
    const context = this.contextFactory();
    const drain = await safeDrainPending(this.consumer, context);
    const metrics = await this.recordBacklogMetrics();
    const durationMilliseconds = Math.max(0, this.clock.epochMilliseconds() - startedAt);

    return Object.freeze({
      outbox: summarizeDrainResult(drain),
      metrics,
      durationMilliseconds,
    });
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    await this.inFlight;
  }

  snapshot(): Readonly<{ running: boolean; intervalMilliseconds: number }> {
    return Object.freeze({
      running: this.running,
      intervalMilliseconds: this.intervalMilliseconds,
    });
  }

  private async recordBacklogMetrics(): Promise<EventOutboxRuntimeLoopMetricSummary> {
    if (this.metricRecorder === undefined) {
      return Object.freeze({
        status: "skipped",
        recorded: 0,
      });
    }

    const recorded = await recordEventOutboxBacklogMetrics({
      eventLog: this.eventLog,
      metricRecorder: this.metricRecorder,
      observedAtEpochMilliseconds: this.clock.epochMilliseconds(),
    });

    if (!recorded.ok) {
      return Object.freeze({
        status: "failed",
        recorded: 0,
        failureCode: recorded.error.code,
      });
    }

    return Object.freeze({
      status: "recorded",
      recorded: recorded.value.recorded,
    });
  }

  private schedule(delayMilliseconds: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.runAndReschedule();
    }, delayMilliseconds);
  }

  private async runAndReschedule(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.inFlight = undefined;

      if (this.running) {
        this.schedule(this.intervalMilliseconds);
      }
    }
  }
}

export function readEventOutboxRuntimeLoopIntervalMilliseconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = env.OMNIWA_EVENT_OUTBOX_LOOP_INTERVAL_MS?.trim();

  if (value === undefined || value.length === 0) {
    return defaultEventOutboxRuntimeLoopIntervalMilliseconds;
  }

  const parsed = Number.parseInt(value, 10);
  assertPositiveInteger(parsed, "OMNIWA_EVENT_OUTBOX_LOOP_INTERVAL_MS");

  return parsed;
}

function createEventOutboxRuntimeContext(
  clock: Pick<Clock, "epochMilliseconds">,
): ApplicationPortContext {
  const observedAt = clock.epochMilliseconds();

  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`event-outbox-runtime:${observedAt}`),
      requestId: createRequestId(`event-outbox-runtime:${observedAt}`),
    }),
    actorRef: "runtime:event-outbox",
    dataClassification: "internal",
  });
}

async function safeDrainPending(
  consumer: EventOutboxRuntimeLoopConsumer,
  context: ApplicationPortContext,
): Promise<ApplicationPortResult<EventOutboxConsumerRunResult>> {
  try {
    return await consumer.drainPending(context);
  } catch (error) {
    return {
      ok: false,
      error: Object.freeze({
        category: "unknown",
        code: "event_outbox_runtime_drain_threw",
        message: "EventLog outbox runtime failed before a safe drain outcome was recorded.",
        retryable: true,
        ownerContext: "observability",
        ...(error instanceof Error
          ? {
              safeMetadata: Object.freeze({
                causeName: error.name,
              }),
            }
          : {}),
      }),
    };
  }
}

function summarizeDrainResult(
  result: ApplicationPortResult<EventOutboxConsumerRunResult>,
): EventOutboxRuntimeLoopOutboxSummary {
  if (!result.ok) {
    return Object.freeze({
      status: "failed",
      attempted: 0,
      published: 0,
      failed: 0,
      failureCode: result.error.code,
    });
  }

  return Object.freeze({
    status: "completed",
    attempted: result.value.attempted,
    published: result.value.published.length,
    failed: result.value.failed.length,
  });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

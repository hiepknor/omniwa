import { systemClock, type Clock } from "@omniwa/shared";

import type { WebhookDispatcherApp } from "./webhook-dispatcher-app.js";
import type { WebhookDispatcherQueueRecoveryCapable } from "./runtime-composition.js";

export type WebhookDispatcherLoopApp = Pick<WebhookDispatcherApp, "runOnce">;

export type WebhookDispatcherLoopOptions = Readonly<{
  app: WebhookDispatcherLoopApp;
  queueProvider?: WebhookDispatcherQueueRecoveryCapable;
  intervalMilliseconds?: number;
  clock?: Pick<Clock, "epochMilliseconds">;
  onError?: (error: unknown) => void;
}>;

export type WebhookDispatcherLoopTickResult = Readonly<{
  recovery: Readonly<{ recovered: number; supported: boolean }>;
  dispatch: Awaited<ReturnType<WebhookDispatcherLoopApp["runOnce"]>>;
  durationMilliseconds: number;
}>;

const defaultWebhookDispatcherLoopIntervalMilliseconds = 5_000;

export class WebhookDispatcherLoop {
  private readonly app: WebhookDispatcherLoopApp;
  private readonly queueProvider: WebhookDispatcherQueueRecoveryCapable | undefined;
  private readonly intervalMilliseconds: number;
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly onError: ((error: unknown) => void) | undefined;

  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(options: WebhookDispatcherLoopOptions) {
    this.app = options.app;
    this.queueProvider = options.queueProvider;
    this.intervalMilliseconds =
      options.intervalMilliseconds ?? defaultWebhookDispatcherLoopIntervalMilliseconds;
    this.clock = options.clock ?? systemClock;
    this.onError = options.onError;
    assertPositiveInteger(this.intervalMilliseconds, "intervalMilliseconds");
  }

  async runOnce(): Promise<WebhookDispatcherLoopTickResult> {
    const startedAt = this.clock.epochMilliseconds();
    const recovery = await this.recoverVisibleJobs();
    const dispatch = await this.app.runOnce();
    const durationMilliseconds = Math.max(0, this.clock.epochMilliseconds() - startedAt);

    return Object.freeze({
      recovery,
      dispatch,
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

  private async recoverVisibleJobs(): Promise<Readonly<{ recovered: number; supported: boolean }>> {
    const recovery = await this.queueProvider?.recoverVisibleJobs?.();

    if (recovery === undefined) {
      return Object.freeze({
        recovered: 0,
        supported: false,
      });
    }

    return Object.freeze({
      recovered: recovery.recovered,
      supported: true,
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

export function readWebhookDispatcherLoopIntervalMilliseconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = env.OMNIWA_WEBHOOK_DISPATCHER_LOOP_INTERVAL_MS?.trim();

  if (value === undefined || value.length === 0) {
    return defaultWebhookDispatcherLoopIntervalMilliseconds;
  }

  const parsed = Number.parseInt(value, 10);
  assertPositiveInteger(parsed, "OMNIWA_WEBHOOK_DISPATCHER_LOOP_INTERVAL_MS");

  return parsed;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

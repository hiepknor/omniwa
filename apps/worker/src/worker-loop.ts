import { systemClock, type Clock } from "@omniwa/shared";

import type { WorkerRuntimeApp, WorkerRuntimeRecoveryResult } from "./worker-app.js";
import type { WorkerRuntimeTickResult } from "./worker-runtime.js";

export type WorkerRuntimeLoopApp = Pick<WorkerRuntimeApp, "recoverVisibleJobs" | "runOnce">;

export type WorkerRuntimeLoopOptions = Readonly<{
  app: WorkerRuntimeLoopApp;
  intervalMilliseconds?: number;
  clock?: Pick<Clock, "epochMilliseconds">;
  onError?: (error: unknown) => void;
}>;

export type WorkerRuntimeLoopTickResult = Readonly<{
  recovery: WorkerRuntimeRecoveryResult;
  runtime: WorkerRuntimeTickResult;
  durationMilliseconds: number;
}>;

const defaultWorkerLoopIntervalMilliseconds = 5_000;

export class WorkerRuntimeLoop {
  private readonly app: WorkerRuntimeLoopApp;
  private readonly intervalMilliseconds: number;
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly onError: ((error: unknown) => void) | undefined;

  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(options: WorkerRuntimeLoopOptions) {
    this.app = options.app;
    this.intervalMilliseconds =
      options.intervalMilliseconds ?? defaultWorkerLoopIntervalMilliseconds;
    this.clock = options.clock ?? systemClock;
    this.onError = options.onError;
    assertPositiveInteger(this.intervalMilliseconds, "intervalMilliseconds");
  }

  async runOnce(): Promise<WorkerRuntimeLoopTickResult> {
    const startedAt = this.clock.epochMilliseconds();
    const recovery = await this.app.recoverVisibleJobs();
    const runtime = await this.app.runOnce();
    const durationMilliseconds = Math.max(0, this.clock.epochMilliseconds() - startedAt);

    return Object.freeze({
      recovery,
      runtime,
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

export function readWorkerLoopIntervalMilliseconds(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.OMNIWA_WORKER_LOOP_INTERVAL_MS?.trim();

  if (value === undefined || value.length === 0) {
    return defaultWorkerLoopIntervalMilliseconds;
  }

  const parsed = Number.parseInt(value, 10);
  assertPositiveInteger(parsed, "OMNIWA_WORKER_LOOP_INTERVAL_MS");

  return parsed;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

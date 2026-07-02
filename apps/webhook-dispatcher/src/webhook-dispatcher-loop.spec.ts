import type { WebhookDispatcherResult } from "@omniwa/infrastructure-webhook";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WebhookDispatcherLoop,
  readWebhookDispatcherLoopIntervalMilliseconds,
} from "./webhook-dispatcher-loop.js";

const idleDispatch: WebhookDispatcherResult = Object.freeze({
  outcome: "idle",
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebhookDispatcherLoop", () => {
  it("recovers visible webhook delivery jobs before each dispatch tick", async () => {
    const app = new CapturingWebhookDispatcherApp();
    const queueProvider = new CapturingRecoveryQueue();
    const clock = new IncrementingClock([100, 132]);
    const loop = new WebhookDispatcherLoop({
      app,
      queueProvider,
      clock,
      intervalMilliseconds: 1_000,
    });

    const result = await loop.runOnce();

    expect(queueProvider.calls).toEqual(["recover"]);
    expect(app.calls).toEqual(["run"]);
    expect(result).toEqual({
      recovery: {
        recovered: 3,
        supported: true,
      },
      dispatch: idleDispatch,
      durationMilliseconds: 32,
    });
  });

  it("starts, schedules repeated dispatch ticks, and stops cleanly", async () => {
    vi.useFakeTimers();
    const app = new CapturingWebhookDispatcherApp();
    const loop = new WebhookDispatcherLoop({
      app,
      intervalMilliseconds: 1_000,
    });

    loop.start();
    loop.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(1_000);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(app.runCount).toBe(2);
    expect(loop.snapshot()).toEqual({
      running: false,
      intervalMilliseconds: 1_000,
    });
  });

  it("reports dispatch errors without stopping future ticks", async () => {
    vi.useFakeTimers();
    const error = new Error("dispatch failed");
    const errors: unknown[] = [];
    const app = new CapturingWebhookDispatcherApp({ failFirstRun: error });
    const loop = new WebhookDispatcherLoop({
      app,
      intervalMilliseconds: 1_000,
      onError: (captured) => errors.push(captured),
    });

    loop.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(1_000);
    await loop.stop();

    expect(errors).toEqual([error]);
    expect(app.runCount).toBe(1);
  });

  it("reads a safe positive loop interval from env", () => {
    expect(readWebhookDispatcherLoopIntervalMilliseconds({})).toBe(5_000);
    expect(
      readWebhookDispatcherLoopIntervalMilliseconds({
        OMNIWA_WEBHOOK_DISPATCHER_LOOP_INTERVAL_MS: "750",
      }),
    ).toBe(750);
    expect(() =>
      readWebhookDispatcherLoopIntervalMilliseconds({
        OMNIWA_WEBHOOK_DISPATCHER_LOOP_INTERVAL_MS: "0",
      }),
    ).toThrow(/positive integer/u);
  });
});

class CapturingWebhookDispatcherApp {
  readonly calls: string[] = [];
  runCount = 0;
  private failed = false;

  constructor(private readonly options: Readonly<{ failFirstRun?: Error }> = {}) {}

  async runOnce() {
    this.calls.push("run");

    if (!this.failed && this.options.failFirstRun !== undefined) {
      this.failed = true;
      throw this.options.failFirstRun;
    }

    this.failed = true;
    this.runCount += 1;

    return idleDispatch;
  }
}

class CapturingRecoveryQueue {
  readonly calls: string[] = [];

  async recoverVisibleJobs() {
    this.calls.push("recover");

    return Object.freeze({
      recovered: 3,
    });
  }
}

class IncrementingClock {
  private index = 0;

  constructor(private readonly values: readonly number[]) {}

  epochMilliseconds(): number {
    const value = this.values[this.index] ?? this.values[this.values.length - 1] ?? 0;
    this.index += 1;

    return value;
  }
}

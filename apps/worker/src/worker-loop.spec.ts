import type { WorkerRuntimeTickResult } from "./worker-runtime.js";
import { WorkerRuntimeLoop, readWorkerLoopIntervalMilliseconds } from "./worker-loop.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const idleRuntimeTick: WorkerRuntimeTickResult = Object.freeze({
  attempted: 0,
  completed: 0,
  retried: 0,
  deadLettered: 0,
  idle: 6,
  failed: 0,
  outcomes: Object.freeze([]),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkerRuntimeLoop", () => {
  it("recovers persisted visible jobs before each runtime tick", async () => {
    const app = new CapturingWorkerApp();
    const clock = new IncrementingClock([100, 135]);
    const loop = new WorkerRuntimeLoop({
      app,
      clock,
      intervalMilliseconds: 1_000,
    });

    const result = await loop.runOnce();

    expect(app.calls).toEqual(["recover", "run"]);
    expect(result).toEqual({
      recovery: {
        recovered: 2,
        supported: true,
      },
      runtime: idleRuntimeTick,
      durationMilliseconds: 35,
    });
  });

  it("starts, schedules repeated ticks, and stops cleanly", async () => {
    vi.useFakeTimers();
    const app = new CapturingWorkerApp();
    const loop = new WorkerRuntimeLoop({
      app,
      intervalMilliseconds: 1_000,
    });

    loop.start();
    loop.start();
    expect(loop.snapshot()).toEqual({
      running: true,
      intervalMilliseconds: 1_000,
    });

    await vi.runOnlyPendingTimersAsync();
    expect(app.runCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(app.runCount).toBe(2);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(app.runCount).toBe(2);
    expect(loop.snapshot()).toEqual({
      running: false,
      intervalMilliseconds: 1_000,
    });
  });

  it("reports loop errors without stopping future ticks", async () => {
    vi.useFakeTimers();
    const error = new Error("recover failed");
    const errors: unknown[] = [];
    const app = new CapturingWorkerApp({ failFirstRecovery: error });
    const loop = new WorkerRuntimeLoop({
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
    expect(readWorkerLoopIntervalMilliseconds({})).toBe(5_000);
    expect(readWorkerLoopIntervalMilliseconds({ OMNIWA_WORKER_LOOP_INTERVAL_MS: "250" })).toBe(250);
    expect(() =>
      readWorkerLoopIntervalMilliseconds({ OMNIWA_WORKER_LOOP_INTERVAL_MS: "0" }),
    ).toThrow(/positive integer/u);
  });
});

class CapturingWorkerApp {
  readonly calls: string[] = [];
  runCount = 0;
  private recovered = false;

  constructor(private readonly options: Readonly<{ failFirstRecovery?: Error }> = {}) {}

  async recoverVisibleJobs() {
    this.calls.push("recover");

    if (!this.recovered && this.options.failFirstRecovery !== undefined) {
      this.recovered = true;
      throw this.options.failFirstRecovery;
    }

    this.recovered = true;
    return Object.freeze({
      recovered: 2,
      supported: true,
    });
  }

  async runOnce() {
    this.calls.push("run");
    this.runCount += 1;

    return idleRuntimeTick;
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

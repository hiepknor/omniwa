import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { toIsoTimestamp } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import { DurableJsonProviderRuntimeSupervisorOwnershipGuard } from "./provider-runtime-ownership-guard.js";

const temporaryDirectories: string[] = [];
const session = Object.freeze({
  instanceId: createInstanceId("provider-runtime-lease-instance"),
  providerId: createProviderId("provider.baileys"),
  sessionId: createSessionId("provider-runtime-lease-session"),
  reasonCode: "provider_runtime_lease_test",
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("DurableJsonProviderRuntimeSupervisorOwnershipGuard", () => {
  it("persists active ownership across guard restarts", () => {
    const filePath = ownershipFilePath();
    const firstGuard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({ filePath });

    expect(firstGuard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });

    const restartedGuard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({ filePath });

    expect(restartedGuard.currentOwner(session)).toBe("provider-owner-a");
    expect(restartedGuard.acquire(session, "provider-owner-b")).toEqual({
      acquired: false,
      ownerRef: "provider-owner-a",
    });
  });

  it("releases only the active owner", () => {
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    expect(guard.release(session, "provider-owner-b")).toBe(false);
    expect(guard.currentOwner(session)).toBe("provider-owner-a");
    expect(guard.release(session, "provider-owner-a")).toBe(true);
    expect(guard.currentOwner(session)).toBeUndefined();
  });

  it("allows a new owner after lease expiry", () => {
    const clock = new ManualClock(1_000);
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
      leaseTtlMilliseconds: 100,
      clock,
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    clock.advance(100);

    expect(guard.currentOwner(session)).toBeUndefined();
    expect(guard.acquire(session, "provider-owner-b")).toEqual({ acquired: true });
    expect(guard.currentOwner(session)).toBe("provider-owner-b");
  });

  it("renews an existing owner lease without creating duplicate records", () => {
    const clock = new ManualClock(1_000);
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
      leaseTtlMilliseconds: 1_000,
      clock,
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    const firstSnapshot = guard.snapshot();
    clock.advance(500);
    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });

    expect(guard.snapshot()).toHaveLength(1);
    expect(guard.snapshot()[0]?.expiresAtEpochMilliseconds).toBeGreaterThan(
      firstSnapshot[0]?.expiresAtEpochMilliseconds ?? 0,
    );
  });

  it("does not expose raw provider payloads in snapshots or conflict decisions", () => {
    const rawProviderPayload = "raw-provider-socket-secret";
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    const conflict = guard.acquire(session, "provider-owner-b");
    const serialized = JSON.stringify({
      conflict,
      snapshot: guard.snapshot(),
    });

    expect(serialized).toContain("provider-owner-a");
    expect(serialized).not.toContain(rawProviderPayload);
  });

  it("rejects invalid lease TTL", () => {
    expect(
      () =>
        new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
          filePath: ownershipFilePath(),
          leaseTtlMilliseconds: 0,
        }),
    ).toThrow(/positive integer/u);
  });
});

function ownershipFilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-provider-ownership-"));
  temporaryDirectories.push(directory);

  return join(directory, "leases.json");
}

class ManualClock {
  constructor(private currentEpochMilliseconds: number) {}

  epochMilliseconds(): number {
    return this.currentEpochMilliseconds;
  }

  isoNow() {
    return toIsoTimestamp(new Date(this.currentEpochMilliseconds));
  }

  advance(milliseconds: number): void {
    this.currentEpochMilliseconds += milliseconds;
  }
}

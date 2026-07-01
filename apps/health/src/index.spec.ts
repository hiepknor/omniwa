import { describe, expect, it } from "vitest";

import { evaluateHealthRuntimeReadiness, healthyProductionDependencies } from "./index.js";

describe("health runtime readiness", () => {
  it("is ready when production dependency probes are healthy", async () => {
    const readiness = await evaluateHealthRuntimeReadiness({
      clock: {
        epochMilliseconds: () => 1_804_000_000_000,
      },
    });

    expect(readiness).toMatchObject({
      runtimeRole: "health",
      readiness: "ready",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "postgres", state: "healthy", critical: true }),
        expect.objectContaining({ name: "queue", state: "healthy", critical: true }),
        expect.objectContaining({ name: "provider", state: "healthy", critical: false }),
        expect.objectContaining({ name: "event_log", state: "healthy", critical: true }),
        expect.objectContaining({ name: "webhook_dispatcher", state: "healthy", critical: true }),
      ]),
    });
  });

  it("is degraded when only a non-critical provider probe is degraded", async () => {
    const readiness = await evaluateHealthRuntimeReadiness({
      dependencies: healthyProductionDependencies.map((dependency) =>
        dependency.name === "provider"
          ? {
              ...dependency,
              probe: () => ({ state: "degraded" as const, causeCode: "provider_degraded" }),
            }
          : dependency,
      ),
      clock: {
        epochMilliseconds: () => 1_804_000_000_000,
      },
    });

    expect(readiness).toMatchObject({
      readiness: "degraded",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "provider",
          state: "degraded",
          critical: false,
          causeCode: "provider_degraded",
        }),
      ]),
    });
  });

  it("is not ready when a critical dependency fails", async () => {
    const readiness = await evaluateHealthRuntimeReadiness({
      dependencies: healthyProductionDependencies.map((dependency) =>
        dependency.name === "queue"
          ? {
              ...dependency,
              probe: () => ({ state: "unavailable" as const, causeCode: "queue_unavailable" }),
            }
          : dependency,
      ),
      clock: {
        epochMilliseconds: () => 1_804_000_000_000,
      },
    });

    expect(readiness).toMatchObject({
      readiness: "not_ready",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "queue",
          state: "unavailable",
          critical: true,
          causeCode: "queue_unavailable",
        }),
      ]),
    });
  });
});

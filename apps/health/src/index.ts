import {
  InMemoryObservabilityRuntime,
  registerDependencyHealthChecks,
  type DependencyHealthOptions,
  type DependencyProbe,
} from "@omniwa/infrastructure-observability";

export type HealthRuntimeReadinessInput = Readonly<{
  dependencies?: readonly DependencyProbe[];
}> &
  DependencyHealthOptions;

export async function evaluateHealthRuntimeReadiness(input: HealthRuntimeReadinessInput = {}) {
  const runtime = new InMemoryObservabilityRuntime({
    ...optional("clock", input.clock),
  });

  registerDependencyHealthChecks(runtime, input.dependencies ?? healthyProductionDependencies, {
    ...optional("clock", input.clock),
  });

  return runtime.evaluateHealth("health");
}

export const healthyProductionDependencies = Object.freeze([
  dependency("postgres"),
  dependency("queue"),
  dependency("provider"),
  dependency("event_log"),
  dependency("webhook_dispatcher"),
]);

function dependency(name: DependencyProbe["name"]): DependencyProbe {
  return Object.freeze({
    name,
    runtimeRole: "health",
    critical: name !== "provider",
    probe: () => ({ state: "healthy" as const }),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

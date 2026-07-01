import {
  createHealthProbeResult,
  type HealthCheck,
  type HealthProbeResult,
  type HealthState,
  type RuntimeRole,
} from "@omniwa/observability";
import { systemClock, type Clock } from "@omniwa/shared";

export const productionDependencyNames = [
  "postgres",
  "queue",
  "provider",
  "event_log",
  "webhook_dispatcher",
] as const;

export type ProductionDependencyName = (typeof productionDependencyNames)[number];

export type DependencyProbeResult = Readonly<{
  state: HealthState;
  causeCode?: string;
}>;

export type DependencyProbe = Readonly<{
  name: ProductionDependencyName;
  runtimeRole: RuntimeRole;
  critical: boolean;
  probe(): Promise<DependencyProbeResult> | DependencyProbeResult;
}>;

export type HealthCheckRegistry = Readonly<{
  registerHealthCheck(check: HealthCheck): void;
}>;

export type DependencyHealthOptions = Readonly<{
  clock?: Pick<Clock, "epochMilliseconds">;
}>;

export function createDependencyHealthCheck(
  dependency: DependencyProbe,
  options: DependencyHealthOptions = {},
): HealthCheck {
  const clock = options.clock ?? systemClock;

  return Object.freeze({
    name: dependency.name,
    runtimeRole: dependency.runtimeRole,
    critical: dependency.critical,
    check: async () => dependencyProbeToHealth(dependency, await dependency.probe(), clock),
  });
}

export function registerDependencyHealthChecks(
  registry: HealthCheckRegistry,
  dependencies: readonly DependencyProbe[],
  options: DependencyHealthOptions = {},
): void {
  for (const dependency of dependencies) {
    registry.registerHealthCheck(createDependencyHealthCheck(dependency, options));
  }
}

function dependencyProbeToHealth(
  dependency: DependencyProbe,
  result: DependencyProbeResult,
  clock: Pick<Clock, "epochMilliseconds">,
): HealthProbeResult {
  return createHealthProbeResult({
    name: dependency.name,
    runtimeRole: dependency.runtimeRole,
    state: result.state,
    critical: dependency.critical,
    checkedAtEpochMilliseconds: clock.epochMilliseconds(),
    ...optional("causeCode", result.causeCode),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

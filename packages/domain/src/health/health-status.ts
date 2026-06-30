import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { HealthStatusId } from "../identity/aggregate-ids.js";
import type { HealthCategory } from "../status/health-category.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";

export type HealthStatus = Readonly<{
  id: HealthStatusId;
  subjectRef: string;
  category: HealthCategory;
  causeCategory?: string;
  domainEvents: readonly DomainEvent[];
}>;

export function createHealthStatus(id: HealthStatusId, subjectRef: string): HealthStatus {
  return freezeHealthStatus({
    id,
    subjectRef: createSafeDomainCode(subjectRef, "HealthStatus.subjectRef"),
    category: "unknown",
    domainEvents: [],
  });
}

export function classifyHealthy(health: HealthStatus): HealthStatus {
  return classifyHealth(health, "healthy", "HealthStatusChanged");
}

export function classifyDegraded(health: HealthStatus, causeCategory: string): HealthStatus {
  return classifyHealth(health, "degraded", "HealthDegraded", causeCategory);
}

export function classifyUnavailable(health: HealthStatus, causeCategory: string): HealthStatus {
  return classifyHealth(health, "unavailable", "HealthDegraded", causeCategory);
}

export function markHealthActionRequired(
  health: HealthStatus,
  causeCategory: string,
): HealthStatus {
  return classifyHealth(health, "action_required", "HealthActionRequired", causeCategory);
}

export function markHealthRecovered(health: HealthStatus): HealthStatus {
  return classifyHealth(health, "recovered", "HealthRecovered");
}

function classifyHealth(
  health: HealthStatus,
  category: HealthCategory,
  eventName: Parameters<typeof appendDomainEvent>[3],
  causeCategory?: string,
): HealthStatus {
  return freezeHealthStatus({
    id: health.id,
    subjectRef: health.subjectRef,
    category,
    ...(causeCategory === undefined
      ? health.causeCategory === undefined
        ? {}
        : { causeCategory: health.causeCategory }
      : { causeCategory: createSafeDomainCode(causeCategory, "HealthStatus.causeCategory") }),
    domainEvents: appendDomainEvent(health.domainEvents, "HealthStatus", health.id, eventName),
  });
}

function freezeHealthStatus(health: HealthStatus): HealthStatus {
  return Object.freeze(health);
}

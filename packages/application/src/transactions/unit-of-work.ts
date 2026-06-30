import type { DomainEvent } from "@omniwa/domain";

import type { ApplicationCommandEnvelope } from "../commands/command-model.js";
import { getApplicationCommandDefinition } from "../commands/command-catalog.js";
import type { ApplicationWorkflowId } from "../workflows/workflow-catalog.js";

export const unitOfWorkBoundaryTypes = [
  "single_aggregate",
  "cross_aggregate_precondition",
  "async_acceptance",
  "worker_execution",
  "projection_evidence",
  "external_side_effect",
] as const;

export type UnitOfWorkBoundaryType = (typeof unitOfWorkBoundaryTypes)[number];

export type UnitOfWorkPlan = Readonly<{
  commandRef: string;
  commandName: ApplicationCommandEnvelope["name"];
  workflowId: ApplicationWorkflowId;
  boundaryType: UnitOfWorkBoundaryType;
  requiresAsyncVisibility: boolean;
  capturedDomainEvents: readonly DomainEvent[];
}>;

export type UnitOfWorkPlanInput = Readonly<{
  command: ApplicationCommandEnvelope;
  workflowId: ApplicationWorkflowId;
  boundaryType?: UnitOfWorkBoundaryType;
  capturedDomainEvents?: readonly DomainEvent[];
}>;

export function createUnitOfWorkPlan(input: UnitOfWorkPlanInput): UnitOfWorkPlan {
  const definition = getApplicationCommandDefinition(input.command.name);
  const boundaryType = input.boundaryType ?? inferUnitOfWorkBoundary(input.command);

  return Object.freeze({
    commandRef: input.command.commandRef,
    commandName: input.command.name,
    workflowId: input.workflowId,
    boundaryType,
    requiresAsyncVisibility: definition.asyncBoundary || boundaryType === "async_acceptance",
    capturedDomainEvents: Object.freeze([...(input.capturedDomainEvents ?? [])]),
  });
}

export function inferUnitOfWorkBoundary(
  command: ApplicationCommandEnvelope,
): UnitOfWorkBoundaryType {
  const definition = getApplicationCommandDefinition(command.name);

  if (definition.trigger === "worker") {
    return "worker_execution";
  }

  if (definition.asyncBoundary) {
    return "async_acceptance";
  }

  if (
    command.name === "RecordAuditEvidence" ||
    command.name === "RefreshHealthStatus" ||
    command.name === "CaptureTelemetrySignal"
  ) {
    return "projection_evidence";
  }

  if (
    command.name === "EvaluateProviderCompatibility" ||
    command.name === "RefreshProviderCapability"
  ) {
    return "external_side_effect";
  }

  if (definition.group === "messaging" || definition.group === "webhook") {
    return "cross_aggregate_precondition";
  }

  return "single_aggregate";
}

export function assertAsyncVisibilityBeforeAcceptance(input: {
  readonly plan: UnitOfWorkPlan;
  readonly asyncWorkVisible: boolean;
}): void {
  if (input.plan.requiresAsyncVisibility && !input.asyncWorkVisible) {
    throw new TypeError("Async acceptance requires visible owner or WorkerJob lifecycle.");
  }
}

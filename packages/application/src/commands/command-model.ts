import type { DomainDataClassification } from "@omniwa/domain";
import type { RequestContext } from "@omniwa/shared";

import {
  getApplicationCommandDefinition,
  isApplicationCommandName,
  isApplicationCommandOutcome,
  type ApplicationCommandName,
  type ApplicationCommandOutcomeName,
} from "./command-catalog.js";

export type ApplicationCommandEnvelope<
  TName extends ApplicationCommandName = ApplicationCommandName,
> = Readonly<{
  kind: "command";
  name: TName;
  commandRef: string;
  requestContext: RequestContext;
  targetRef?: string;
  actorRef?: string;
  idempotencyKey?: string;
  safeInputRef?: string;
  safeInput?: Readonly<Record<string, unknown>>;
  dataClassification?: DomainDataClassification;
}>;

export type ApplicationCommandEnvelopeInput = Readonly<{
  name: string;
  commandRef: string;
  requestContext: RequestContext;
  targetRef?: string;
  actorRef?: string;
  idempotencyKey?: string;
  safeInputRef?: string;
  safeInput?: Readonly<Record<string, unknown>>;
  dataClassification?: DomainDataClassification;
}>;

export type ApplicationCommandOutcome = Readonly<{
  kind: "command_outcome";
  commandRef: string;
  outcome: ApplicationCommandOutcomeName;
  accepted: boolean;
  retryable: boolean;
  resultRef?: string;
  reasonCode?: string;
}>;

export type ApplicationCommandOutcomeInput = Omit<ApplicationCommandOutcome, "kind">;

export function createApplicationCommandEnvelope(
  input: ApplicationCommandEnvelopeInput,
): ApplicationCommandEnvelope {
  if (!isApplicationCommandName(input.name)) {
    throw new TypeError("ApplicationCommandEnvelope.name must be an approved command.");
  }

  const definition = getApplicationCommandDefinition(input.name);

  if (definition.idempotencyRequired && input.idempotencyKey === undefined) {
    throw new TypeError("ApplicationCommandEnvelope.idempotencyKey is required for this command.");
  }

  return Object.freeze({
    ...input,
    ...(input.safeInput === undefined ? {} : { safeInput: Object.freeze({ ...input.safeInput }) }),
    kind: "command",
    name: input.name,
  });
}

export function createApplicationCommandOutcome(
  input: ApplicationCommandOutcomeInput,
): ApplicationCommandOutcome {
  if (!isApplicationCommandOutcome(input.outcome)) {
    throw new TypeError("ApplicationCommandOutcome.outcome must be approved.");
  }

  return Object.freeze({
    ...input,
    kind: "command_outcome",
  });
}

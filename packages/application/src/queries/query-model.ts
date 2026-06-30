import type { DomainDataClassification } from "@omniwa/domain";
import type { RequestContext } from "@omniwa/shared";

import type { ReadConsistencyLevel, ReadFreshness } from "../ports/read-model.js";
import {
  getApplicationQueryDefinition,
  isApplicationQueryName,
  isApplicationQueryOutcome,
  type ApplicationQueryName,
  type ApplicationQueryOutcomeName,
} from "./query-catalog.js";

export type ApplicationQueryEnvelope<TName extends ApplicationQueryName = ApplicationQueryName> =
  Readonly<{
    kind: "query";
    name: TName;
    queryRef: string;
    requestContext: RequestContext;
    targetRef?: string;
    actorRef?: string;
    requestedConsistency?: ReadConsistencyLevel;
    safeCriteriaRef?: string;
    dataClassification?: DomainDataClassification;
  }>;

export type ApplicationQueryEnvelopeInput = Readonly<{
  name: string;
  queryRef: string;
  requestContext: RequestContext;
  targetRef?: string;
  actorRef?: string;
  requestedConsistency?: ReadConsistencyLevel;
  safeCriteriaRef?: string;
  dataClassification?: DomainDataClassification;
}>;

export type ApplicationQueryOutcome = Readonly<{
  kind: "query_outcome";
  queryRef: string;
  outcome: ApplicationQueryOutcomeName;
  consistency: ReadConsistencyLevel;
  freshness: ReadFreshness;
  resultRef?: string;
  reasonCode?: string;
}>;

export type ApplicationQueryOutcomeInput = Omit<ApplicationQueryOutcome, "kind">;

export function createApplicationQueryEnvelope(
  input: ApplicationQueryEnvelopeInput,
): ApplicationQueryEnvelope {
  if (!isApplicationQueryName(input.name)) {
    throw new TypeError("ApplicationQueryEnvelope.name must be an approved query.");
  }

  getApplicationQueryDefinition(input.name);

  return Object.freeze({
    ...input,
    kind: "query",
    name: input.name,
  });
}

export function createApplicationQueryOutcome(
  input: ApplicationQueryOutcomeInput,
): ApplicationQueryOutcome {
  if (!isApplicationQueryOutcome(input.outcome)) {
    throw new TypeError("ApplicationQueryOutcome.outcome must be approved.");
  }

  return Object.freeze({
    ...input,
    kind: "query_outcome",
  });
}

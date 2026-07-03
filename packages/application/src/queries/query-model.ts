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
  resource?: Readonly<Record<string, unknown>>;
  items?: readonly unknown[];
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

  const resource =
    input.resource === undefined ? undefined : Object.freeze({ ...input.resource });
  const items = input.items === undefined ? undefined : Object.freeze([...input.items]);

  return Object.freeze({
    ...input,
    ...optional("resource", resource),
    ...optional("items", items),
    kind: "query_outcome",
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

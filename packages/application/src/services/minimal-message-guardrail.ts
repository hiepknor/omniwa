import {
  acceptMessage,
  createGuardrailDecisionAggregate,
  isGuardrailDecisionPassing,
  isSpecificationPass,
  type GuardrailDecision,
  type GuardrailDecisionId,
  type GuardrailDecisionRepositoryPort,
  type GuardrailOutcome,
  type Message,
} from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

import type { OutboundMessageIntentRef } from "../ports/outbound-message-intent-store.js";
import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
} from "../ports/application-port.js";

export type MinimalMessageGuardrailInput = Readonly<{
  guardrailDecisionId: GuardrailDecisionId;
  outboundIntentRef: OutboundMessageIntentRef;
  outcome?: GuardrailOutcome;
  reasonCode?: string;
}>;

export type MinimalMessageGuardrailService = Readonly<{
  createDecision(
    input: MinimalMessageGuardrailInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<GuardrailDecision>>;

  acceptMessageAfterGuardrailPass(
    message: Message,
    decision: GuardrailDecision,
    outboundIntentRef: OutboundMessageIntentRef,
    context: ApplicationPortContext,
  ): ApplicationPortResult<Message>;
}>;

export type MinimalMessageGuardrailServiceOptions = Readonly<{
  guardrailDecisionRepository: Pick<
    GuardrailDecisionRepositoryPort,
    "findByEvaluatedIntent" | "save"
  >;
}>;

export function createMinimalMessageGuardrailService(
  options: MinimalMessageGuardrailServiceOptions,
): MinimalMessageGuardrailService {
  return new DefaultMinimalMessageGuardrailService(options);
}

export class DefaultMinimalMessageGuardrailService implements MinimalMessageGuardrailService {
  private readonly guardrailDecisionRepository: Pick<
    GuardrailDecisionRepositoryPort,
    "findByEvaluatedIntent" | "save"
  >;

  constructor(options: MinimalMessageGuardrailServiceOptions) {
    this.guardrailDecisionRepository = options.guardrailDecisionRepository;
  }

  async createDecision(
    input: MinimalMessageGuardrailInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<GuardrailDecision>> {
    void context;

    const evaluatedIntentRef = String(input.outboundIntentRef);
    const outcome = input.outcome ?? "allow";

    let existingDecision: GuardrailDecision | undefined;
    let decision: GuardrailDecision;

    try {
      existingDecision =
        await this.guardrailDecisionRepository.findByEvaluatedIntent(evaluatedIntentRef);
    } catch {
      return err(
        createGuardrailFailure({
          category: "unavailable",
          code: "minimal_guardrail_dependency_failure",
          message: "Guardrail decision repository is unavailable.",
          retryable: true,
          guardrailDecisionId: input.guardrailDecisionId,
          evaluatedIntentRef,
        }),
      );
    }

    try {
      decision =
        existingDecision ??
        createGuardrailDecisionAggregate({
          id: input.guardrailDecisionId,
          evaluatedIntentRef,
          outcome,
          reasonCode: input.reasonCode ?? defaultReasonCode(outcome),
        });
    } catch {
      return err(
        createGuardrailFailure({
          category: "rejected",
          code: "minimal_guardrail_decision_rejected",
          message: "Guardrail decision input was rejected.",
          retryable: false,
          guardrailDecisionId: input.guardrailDecisionId,
          evaluatedIntentRef,
        }),
      );
    }

    try {
      await this.guardrailDecisionRepository.save(decision);
    } catch {
      return err(
        createGuardrailFailure({
          category: "unavailable",
          code: "minimal_guardrail_dependency_failure",
          message: "Guardrail decision repository is unavailable.",
          retryable: true,
          guardrailDecisionId: decision.id,
          evaluatedIntentRef,
        }),
      );
    }

    const passResult = isGuardrailDecisionPassing(decision, evaluatedIntentRef);

    if (!isSpecificationPass(passResult)) {
      return err(createGuardrailNotPassingFailure(decision, evaluatedIntentRef));
    }

    return ok(decision);
  }

  acceptMessageAfterGuardrailPass(
    message: Message,
    decision: GuardrailDecision,
    outboundIntentRef: OutboundMessageIntentRef,
    context: ApplicationPortContext,
  ): ApplicationPortResult<Message> {
    void context;

    const evaluatedIntentRef = String(outboundIntentRef);
    const passResult = isGuardrailDecisionPassing(decision, evaluatedIntentRef);

    if (!isSpecificationPass(passResult)) {
      return err(createGuardrailNotPassingFailure(decision, evaluatedIntentRef));
    }

    try {
      return ok(acceptMessage(message, decision.id));
    } catch {
      return err(
        createGuardrailFailure({
          category: "rejected",
          code: "message_guardrail_accept_rejected",
          message: "Message could not be accepted after guardrail validation.",
          retryable: false,
          guardrailDecisionId: decision.id,
          evaluatedIntentRef,
        }),
      );
    }
  }
}

function defaultReasonCode(outcome: GuardrailOutcome): string {
  switch (outcome) {
    case "allow":
      return "minimal_guardrail_pass";
    case "block":
      return "minimal_guardrail_block";
    case "throttle":
      return "minimal_guardrail_throttle";
    case "action_required":
      return "minimal_guardrail_action_required";
  }
}

function createGuardrailNotPassingFailure(
  decision: GuardrailDecision,
  evaluatedIntentRef: string,
): ApplicationPortFailure {
  return createGuardrailFailure({
    category: "rejected",
    code: "message_guardrail_not_passing",
    message: "Guardrail decision must allow the outbound message before acceptance.",
    retryable: false,
    guardrailDecisionId: decision.id,
    evaluatedIntentRef,
    status: decision.status,
    outcome: decision.outcome ?? "unknown",
  });
}

function createGuardrailFailure(
  input: Readonly<{
    category: ApplicationPortFailure["category"];
    code: string;
    message: string;
    retryable: boolean;
    guardrailDecisionId: GuardrailDecisionId;
    evaluatedIntentRef: string;
    status?: string;
    outcome?: string;
  }>,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: input.category,
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ownerContext: "guardrails",
    failureCategory: "security",
    safeMetadata: {
      guardrailDecisionId: String(input.guardrailDecisionId),
      evaluatedIntentRef: input.evaluatedIntentRef,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    },
  });
}

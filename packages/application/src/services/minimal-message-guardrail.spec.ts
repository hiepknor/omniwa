import {
  createGuardrailDecisionId,
  createInstanceId,
  createMessageId,
  createOutboundMessageIntent,
  type GuardrailDecision,
  type GuardrailDecisionId,
  type GuardrailDecisionRepositoryPort,
  type Message,
  type RepositorySaveResult,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import type { ApplicationPortContext } from "../ports/application-port.js";
import { createOutboundMessageIntentRef } from "../ports/outbound-message-intent-store.js";
import { createMinimalMessageGuardrailService } from "./minimal-message-guardrail.js";

const outboundIntentRef = createOutboundMessageIntentRef("intent_safe_text_1");
const guardrailDecisionId = createGuardrailDecisionId("guardrail_minimal_1");
const requestContext = createRequestContext({
  requestId: createRequestId("minimal-guardrail-request"),
  correlationId: createCorrelationId("minimal-guardrail-correlation"),
});
const applicationContext: ApplicationPortContext = Object.freeze({
  requestContext,
  actorRef: "api_key:test",
});

describe("minimal message guardrail service", () => {
  it("creates and saves a valid minimal pass decision", async () => {
    const repository = new FakeGuardrailDecisionRepository();
    const service = createMinimalMessageGuardrailService({
      guardrailDecisionRepository: repository,
    });

    const result = await service.createDecision(
      {
        guardrailDecisionId,
        outboundIntentRef,
      },
      applicationContext,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: guardrailDecisionId,
        evaluatedIntentRef: "intent_safe_text_1",
        status: "passed",
        outcome: "allow",
        reasonCode: "minimal_guardrail_pass",
      });
    }
    await expect(repository.findByEvaluatedIntent("intent_safe_text_1")).resolves.toMatchObject({
      id: guardrailDecisionId,
      status: "passed",
      outcome: "allow",
    });
  });

  it("returns a safe failure for blocked guardrail decisions", async () => {
    const repository = new FakeGuardrailDecisionRepository();
    const service = createMinimalMessageGuardrailService({
      guardrailDecisionRepository: repository,
    });

    const result = await service.createDecision(
      {
        guardrailDecisionId: createGuardrailDecisionId("guardrail_blocked_1"),
        outboundIntentRef,
        outcome: "block",
      },
      applicationContext,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        category: "rejected",
        code: "message_guardrail_not_passing",
        message: "Guardrail decision must allow the outbound message before acceptance.",
        retryable: false,
        ownerContext: "guardrails",
        failureCategory: "security",
        safeMetadata: Object.freeze({
          guardrailDecisionId: "guardrail_blocked_1",
          evaluatedIntentRef: "intent_safe_text_1",
          status: "blocked",
          outcome: "block",
        }),
      });
    }
  });

  it("accepts outbound messages only after guardrail pass", async () => {
    const repository = new FakeGuardrailDecisionRepository();
    const service = createMinimalMessageGuardrailService({
      guardrailDecisionRepository: repository,
    });
    const message = createTextMessage();
    const decisionResult = await service.createDecision(
      {
        guardrailDecisionId,
        outboundIntentRef,
      },
      applicationContext,
    );

    expect(decisionResult.ok).toBe(true);
    if (!decisionResult.ok) {
      throw new Error("Expected pass decision for message acceptance test.");
    }

    const accepted = service.acceptMessageAfterGuardrailPass(
      message,
      decisionResult.value,
      outboundIntentRef,
      applicationContext,
    );

    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.status).toBe("evaluated");
      expect(accepted.value.guardrailDecisionId).toBe(guardrailDecisionId);
    }

    const blockedResult = await service.createDecision(
      {
        guardrailDecisionId: createGuardrailDecisionId("guardrail_blocked_2"),
        outboundIntentRef: createOutboundMessageIntentRef("intent_safe_text_2"),
        outcome: "block",
      },
      applicationContext,
    );
    const blockedDecision = await repository.findByEvaluatedIntent("intent_safe_text_2");

    expect(blockedResult.ok).toBe(false);
    expect(blockedDecision).toBeDefined();

    if (blockedDecision === undefined) {
      throw new Error("Expected blocked decision to be saved.");
    }

    const blockedMessage = createTextMessage();
    const rejected = service.acceptMessageAfterGuardrailPass(
      blockedMessage,
      blockedDecision,
      createOutboundMessageIntentRef("intent_safe_text_2"),
      applicationContext,
    );

    expect(rejected.ok).toBe(false);
    expect(blockedMessage.status).toBe("created");
  });

  it("does not expose raw text or JID in safe failures", async () => {
    const repository = new FakeGuardrailDecisionRepository();
    const service = createMinimalMessageGuardrailService({
      guardrailDecisionRepository: repository,
    });
    const rawText = "secret body text";
    const rawJid = "84999999999@s.whatsapp.net";

    const result = await service.createDecision(
      {
        guardrailDecisionId: createGuardrailDecisionId("guardrail_invalid_reason"),
        outboundIntentRef,
        outcome: "allow",
        reasonCode: `Raw ${rawJid} ${rawText}`,
      },
      applicationContext,
    );
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(false);
    expect(serialized).not.toContain(rawText);
    expect(serialized).not.toContain(rawJid);
    expect(serialized).not.toContain("Raw");
  });
});

function createTextMessage(): Message {
  return createOutboundMessageIntent({
    id: createMessageId("msg_minimal_guardrail_1"),
    instanceId: createInstanceId("inst_minimal_guardrail_1"),
    type: "text",
  });
}

class FakeGuardrailDecisionRepository implements GuardrailDecisionRepositoryPort {
  private readonly records = new Map<string, GuardrailDecision>();

  load(id: GuardrailDecisionId): Promise<GuardrailDecision | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: GuardrailDecision): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: GuardrailDecisionId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByEvaluatedIntent(evaluatedIntentRef: string): Promise<GuardrailDecision | undefined> {
    return Promise.resolve(
      [...this.records.values()].find(
        (decision) => decision.evaluatedIntentRef === evaluatedIntentRef,
      ),
    );
  }
}

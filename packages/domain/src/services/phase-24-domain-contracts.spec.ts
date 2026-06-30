import { describe, expect, it } from "vitest";

import { activateSession } from "../session/session.js";
import { createFailureCategory } from "../errors/failure-category.js";
import {
  createAccessDecisionId,
  createAuditRecordId,
  createConfigurationSnapshotId,
  createGuardrailDecisionId,
  createInstanceId,
  createJobId,
  createMediaId,
  createMessageId,
  createProviderId,
  createSessionId,
  createWebhookDeliveryId,
  createWebhookId,
} from "../identity/aggregate-ids.js";
import { createMediaCategory } from "../media/media-category.js";
import { createMessageType } from "../messaging/message-type.js";
import { createRetryPolicy } from "../policies/retry-policy.js";
import type { MessageRepositoryPort } from "../repositories/repository-ports.js";
import { createWebhookUrl } from "../webhook/webhook-url.js";
import {
  canSendMessage,
  isMessageTypeSupported,
  isTelemetryProjectionSafe,
} from "../specifications/domain-specifications.js";
import { isSpecificationPass } from "../specifications/specification-result.js";
import {
  evaluateComplianceGuardrailPolicy,
  evaluateMessageSendingPolicy,
  evaluateWebhookRetryPolicy,
} from "../policies/domain-policies.js";
import {
  decideInstanceReadiness,
  decideMessageAcceptance,
  decideRetryEligibility,
  decideTelemetryProjection,
} from "./domain-services.js";
import {
  createAccessDecisionAggregate,
  createAuditRecordAggregate,
  createConfigurationSnapshotAggregate,
  createGuardrailDecisionAggregate,
  createInboundMessageAggregate,
  createInstanceAggregate,
  createMediaAssetAggregate,
  createOutboundMessageAggregate,
  createProviderProfileAggregate,
  createSessionAggregate,
  createWebhookDeliveryAggregate,
  createWebhookSubscriptionAggregate,
  createWorkerJobAggregate,
} from "../factories/domain-factories.js";
import { markMediaProcessed, markMediaProcessing } from "../media/media-asset.js";
import { createRetentionPolicy } from "../policies/retention-policy.js";
import { startWebhookDelivery } from "../webhook/webhook-delivery.js";
import { createAttemptNumber } from "../policies/attempt-number.js";

describe("Phase 2.4 domain contracts", () => {
  it("defines repository ports as aggregate contracts without implementation details", async () => {
    const message = createOutboundMessageAggregate({
      id: createMessageId("repo_message_1"),
      instanceId: createInstanceId("repo_instance_1"),
      type: createMessageType("text"),
    });
    const repository: MessageRepositoryPort = {
      load: async () => message,
      save: async () => ({ saved: true }),
      exists: async () => true,
      findByStatus: async () => [message],
      findByIdempotencyKey: async () => message,
      findRecoverableByOwner: async () => [message],
    };

    await expect(repository.load(message.id)).resolves.toBe(message);
    await expect(repository.save(message)).resolves.toEqual({ saved: true });
  });

  it("evaluates specifications for supported message scope", () => {
    const session = activateSession(
      createSessionAggregate({
        id: createSessionId("spec_session_1"),
        instanceId: createInstanceId("spec_instance_1"),
        startPairing: true,
      }),
    );
    const guardrailDecision = createGuardrailDecisionAggregate({
      id: createGuardrailDecisionId("spec_guardrail_1"),
      evaluatedIntentRef: "message_intent",
      outcome: "allow",
      reasonCode: "safe_intent",
    });
    const providerProfile = createProviderProfileAggregate({
      id: createProviderId("spec_provider_1"),
      providerKind: "baileys",
      status: "supported",
      supportedMessageTypes: [createMessageType("text")],
    });

    const result = canSendMessage({
      messageType: "text",
      session,
      guardrailDecision,
      providerProfile,
      intentScope: "single_message",
    });
    const rejected = canSendMessage({
      messageType: "sticker",
      session,
      guardrailDecision,
      providerProfile,
      intentScope: "single_message",
    });

    expect(isMessageTypeSupported("text").passed).toBe(true);
    expect(result.passed).toBe(true);
    expect(rejected.passed).toBe(false);
    expect(isSpecificationPass(rejected)).toBe(false);
  });

  it("evaluates policies without touching repositories or provider adapters", () => {
    const throttled = evaluateComplianceGuardrailPolicy({
      intentScope: "single_message",
      rateLimitAllowed: false,
      abuseRiskDetected: false,
      configurationSafety: "valid",
      direction: "outbound",
    });
    const blocked = evaluateComplianceGuardrailPolicy({
      intentScope: "single_message",
      rateLimitAllowed: true,
      abuseRiskDetected: true,
      configurationSafety: "valid",
      direction: "outbound",
    });

    expect(throttled).toBe("throttle");
    expect(blocked).toBe("block");
  });

  it("orchestrates domain-service decisions from safe snapshots only", () => {
    const instance = createInstanceAggregate(createInstanceId("service_instance_1"));
    const session = activateSession(
      createSessionAggregate({
        id: createSessionId("service_session_1"),
        instanceId: instance.id,
        startPairing: true,
      }),
    );
    const providerProfile = createProviderProfileAggregate({
      id: createProviderId("service_provider_1"),
      providerKind: "baileys",
      status: "supported",
      supportedMessageTypes: [createMessageType("text")],
    });
    const guardrailDecision = createGuardrailDecisionAggregate({
      id: createGuardrailDecisionId("service_guardrail_1"),
      evaluatedIntentRef: "message_intent",
      outcome: "allow",
      reasonCode: "safe_intent",
    });

    const acceptance = decideMessageAcceptance({
      messageType: "text",
      session,
      guardrailDecision,
      providerProfile,
      intentScope: "single_message",
    });
    const readiness = decideInstanceReadiness({
      instance,
      session,
      translatedProviderReady: true,
      providerLoggedOut: false,
      providerActionRequired: false,
    });

    expect(acceptance.outcome).toBe("allow");
    expect(readiness.sendCapable).toBe(true);
    expect(readiness.recommendedStatus).toBe("connected");
  });

  it("evaluates retry and safety services with finite product rules", () => {
    const retryPolicy = createRetryPolicy({
      maxAttempts: 2,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const delivery = startWebhookDelivery(
      createWebhookDeliveryAggregate({
        id: createWebhookDeliveryId("service_delivery_1"),
        webhookId: createWebhookId("service_webhook_1"),
        sourceSignalRef: "message_failed",
        retryPolicy,
      }),
      createAttemptNumber(1, retryPolicy),
    );
    const retry = evaluateWebhookRetryPolicy(delivery, 2);
    const serviceRetry = decideRetryEligibility({
      kind: "webhook_delivery",
      delivery,
      nextAttempt: 2,
    });
    const unsafeTelemetry = decideTelemetryProjection({
      dataClassification: "secret",
      redacted: true,
      correlationSafe: true,
      projectionCategoryApproved: true,
    });

    expect(retry.outcome).toBe("retry");
    expect(serviceRetry.retryable).toBe(true);
    expect(
      isTelemetryProjectionSafe({
        dataClassification: "secret",
        redacted: true,
        correlationSafe: true,
        projectionCategoryApproved: true,
      }).passed,
    ).toBe(false);
    expect(unsafeTelemetry.outcome).toBe("reject");
  });

  it("creates aggregate roots through factories with creation-time invariants", () => {
    const retentionPolicy = createRetentionPolicy({
      category: "media_metadata",
      retentionDays: 30,
    });
    const auditRetention = createRetentionPolicy({
      category: "audit_record",
      retentionDays: 90,
    });
    const retryPolicy = createRetryPolicy({
      maxAttempts: 3,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const instance = createInstanceAggregate(createInstanceId("factory_instance_1"));
    const inbound = createInboundMessageAggregate({
      id: createMessageId("factory_message_1"),
      instanceId: instance.id,
      type: createMessageType("text"),
    });
    const media = createMediaAssetAggregate({
      id: createMediaId("factory_media_1"),
      category: createMediaCategory("image"),
      retentionPolicy,
      accept: true,
      diagnosticCapture: true,
    });
    const processedMedia = markMediaProcessed(markMediaProcessing(media));
    const subscription = createWebhookSubscriptionAggregate({
      id: createWebhookId("factory_webhook_1"),
      targetUrl: createWebhookUrl("https://example.test/webhook"),
    });
    const delivery = createWebhookDeliveryAggregate({
      id: createWebhookDeliveryId("factory_delivery_1"),
      webhookId: subscription.id,
      sourceSignalRef: "message_received",
      retryPolicy,
    });
    const job = createWorkerJobAggregate({
      id: createJobId("factory_job_1"),
      ownerContext: "messaging",
      workType: "send_message",
      retryPolicy,
    });
    const access = createAccessDecisionAggregate({
      id: createAccessDecisionId("factory_access_1"),
      actorRef: "operator_1",
      capability: "destroy_instance",
      outcome: "granted",
      privileged: true,
    });
    const audit = createAuditRecordAggregate({
      id: createAuditRecordId("factory_audit_1"),
      auditCategory: "instance_destroyed",
      retentionPolicy: auditRetention,
      evidenceSummaryCode: "operator_action",
      redacted: true,
    });
    const config = createConfigurationSnapshotAggregate({
      id: createConfigurationSnapshotId("factory_config_1"),
      safety: "valid",
    });

    expect(instance.status).toBe("created");
    expect(inbound.domainEvents.at(0)?.name).toBe("InboundMessageReceived");
    expect(processedMedia.status).toBe("processed");
    expect(delivery.status).toBe("pending");
    expect(job.status).toBe("queued");
    expect(access.auditEligible).toBe(true);
    expect(audit.status).toBe("recorded");
    expect(config.status).toBe("validated");
  });

  it("rejects factory input that would hide required classifications", () => {
    expect(() =>
      createProviderProfileAggregate({
        id: createProviderId("factory_provider_1"),
        providerKind: "baileys",
        status: "degraded",
      }),
    ).toThrow(TypeError);

    const profile = createProviderProfileAggregate({
      id: createProviderId("factory_provider_2"),
      providerKind: "baileys",
      status: "unsupported",
      failureCategory: createFailureCategory("provider"),
    });

    expect(profile.status).toBe("unsupported");
  });

  it("reuses policy decisions from services and policies consistently", () => {
    const session = activateSession(
      createSessionAggregate({
        id: createSessionId("policy_session_1"),
        instanceId: createInstanceId("policy_instance_1"),
        startPairing: true,
      }),
    );
    const guardrailDecision = createGuardrailDecisionAggregate({
      id: createGuardrailDecisionId("policy_guardrail_1"),
      evaluatedIntentRef: "message_intent",
      outcome: "block",
      reasonCode: "unsupported_broadcast",
    });
    const providerProfile = createProviderProfileAggregate({
      id: createProviderId("policy_provider_1"),
      providerKind: "baileys",
      status: "supported",
      supportedMessageTypes: [createMessageType("text")],
    });
    const policyDecision = evaluateMessageSendingPolicy({
      messageType: "text",
      session,
      guardrailDecision,
      providerProfile,
      intentScope: "single_message",
    });

    expect(policyDecision.outcome).toBe("reject");
    expect(policyDecision.specification.passed).toBe(false);
  });
});

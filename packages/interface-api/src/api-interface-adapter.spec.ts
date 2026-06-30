import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
} from "@omniwa/application";
import { describe, expect, it } from "vitest";

import {
  ApiInterfaceAdapter,
  type ApiCredential,
  type ApiRequest,
  type ApplicationInterfaceDispatcher,
} from "./api-interface-adapter.js";

const publicMessagingCredential: ApiCredential = {
  kind: "api_key",
  keyId: "public-key",
  scopes: ["messages:send", "messages:read"],
  allowedInstanceRefs: ["inst_allowed"],
};

const monitoringCredential: ApiCredential = {
  kind: "monitoring_key",
  keyId: "monitoring-key",
  scopes: ["metrics:read", "health:read", "jobs:read"],
};

const adminCredential: ApiCredential = {
  kind: "admin_key",
  keyId: "admin-key",
  scopes: ["admin:*"],
};

describe("ApiInterfaceAdapter", () => {
  it("maps a public async command request into an Application command envelope", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const response = await adapter.handle({
      kind: "command",
      boundary: "public",
      name: "SendTextMessage",
      requestRef: "api-request-1",
      requestId: "request-1",
      correlationId: "correlation-1",
      credential: publicMessagingCredential,
      targetRef: "inst_allowed",
      idempotencyKey: "send-message-1",
      safeInputRef: "input-ref-1",
      dataClassification: "confidential",
    });

    expect(response.ok).toBe(true);
    expect(response.ok ? response.status : undefined).toBe("queued");
    expect(response.ok ? response.meta.async : undefined).toBe(true);
    expect(response.ok ? response.meta.applicationService : undefined).toBe(
      "MessagingApplicationService",
    );
    expect(response.ok ? response.meta.workflowRefs : undefined).toEqual(["WF-MSG-001"]);
    expect(dispatcher.commandEnvelopes).toEqual([
      expect.objectContaining({
        kind: "command",
        name: "SendTextMessage",
        commandRef: "api-request-1",
        targetRef: "inst_allowed",
        actorRef: "api_key:public-key",
        idempotencyKey: "send-message-1",
        safeInputRef: "input-ref-1",
        dataClassification: "confidential",
      }),
    ]);
  });

  it("rejects duplicate-prone commands when Idempotency-Key is missing", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const response = await adapter.handle({
      kind: "command",
      boundary: "public",
      name: "SendTextMessage",
      requestRef: "api-request-2",
      credential: publicMessagingCredential,
      targetRef: "inst_allowed",
    });

    expect(response.ok).toBe(false);
    expect(response.ok ? undefined : response.error).toMatchObject({
      category: "validation",
      code: "invalid_api_mapping",
      retryable: false,
    });
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
  });

  it("rejects public access to admin-only command boundaries", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const response = await adapter.handle({
      kind: "command",
      boundary: "public",
      name: "DestroyInstance",
      requestRef: "api-request-3",
      credential: {
        ...publicMessagingCredential,
        scopes: ["instances:destroy"],
      },
      targetRef: "inst_allowed",
    });

    expect(response.ok).toBe(false);
    expect(response.ok ? undefined : response.error).toMatchObject({
      category: "authorization",
      code: "command_not_allowed_at_boundary",
    });
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
  });

  it("allows admin boundary commands through Application only", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const response = await adapter.handle({
      kind: "command",
      boundary: "admin",
      name: "DestroyInstance",
      requestRef: "api-request-4",
      credential: adminCredential,
      targetRef: "inst_any",
    });

    expect(response.ok).toBe(true);
    expect(response.ok ? response.meta.applicationService : undefined).toBe(
      "InstanceApplicationService",
    );
    expect(dispatcher.commandEnvelopes[0]).toMatchObject({
      name: "DestroyInstance",
      actorRef: "admin_key:admin-key",
      targetRef: "inst_any",
    });
  });

  it("maps monitoring queries into Application query envelopes", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const response = await adapter.handle({
      kind: "query",
      boundary: "monitoring",
      name: "GetQueueMetricsSnapshot",
      requestRef: "api-query-1",
      credential: monitoringCredential,
      requestedConsistency: "eventual_projection",
      safeCriteriaRef: "queue-metrics",
    });

    expect(response.ok).toBe(true);
    expect(response.ok ? response.status : undefined).toBe("result");
    expect(response.ok ? response.meta.applicationService : undefined).toBe(
      "QueryApplicationService",
    );
    expect(response.ok ? response.meta.workflowRefs : undefined).toEqual(["WF-QRY-001"]);
    expect(dispatcher.queryEnvelopes).toEqual([
      expect.objectContaining({
        kind: "query",
        name: "GetQueueMetricsSnapshot",
        queryRef: "api-query-1",
        actorRef: "monitoring_key:monitoring-key",
        requestedConsistency: "eventual_projection",
        safeCriteriaRef: "queue-metrics",
      }),
    ]);
  });

  it("rejects credentials outside their instance boundary", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const response = await adapter.handle({
      kind: "query",
      boundary: "public",
      name: "GetMessageStatus",
      requestRef: "api-query-2",
      credential: publicMessagingCredential,
      targetRef: "inst_denied",
    });

    expect(response.ok).toBe(false);
    expect(response.ok ? undefined : response.error).toMatchObject({
      category: "authorization",
      code: "instance_boundary_denied",
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("rejects unauthenticated API requests before dispatcher invocation", async () => {
    const dispatcher = new CapturingApplicationDispatcher();
    const adapter = new ApiInterfaceAdapter({ dispatcher });

    const request: ApiRequest = {
      kind: "query",
      boundary: "public",
      name: "GetInstanceStatus",
      requestRef: "api-query-3",
      targetRef: "inst_allowed",
    };

    const response = await adapter.handle(request);

    expect(response.ok).toBe(false);
    expect(response.ok ? undefined : response.error).toMatchObject({
      category: "authentication",
      code: "missing_credential",
    });
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });
});

class CapturingApplicationDispatcher implements ApplicationInterfaceDispatcher {
  readonly commandEnvelopes: ApplicationCommandEnvelope[] = [];
  readonly queryEnvelopes: ApplicationQueryEnvelope[] = [];

  executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
    this.commandEnvelopes.push(envelope);

    return createApplicationCommandOutcome({
      commandRef: envelope.commandRef,
      outcome: getCommandOutcome(envelope),
      accepted: true,
      retryable: false,
      resultRef: `${envelope.commandRef}:result`,
    });
  }

  executeQuery(envelope: ApplicationQueryEnvelope): ApplicationQueryOutcome {
    this.queryEnvelopes.push(envelope);

    return createApplicationQueryOutcome({
      queryRef: envelope.queryRef,
      outcome: "result",
      consistency: envelope.requestedConsistency ?? "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1,
      },
      resultRef: `${envelope.queryRef}:result`,
    });
  }
}

function getCommandOutcome(
  envelope: ApplicationCommandEnvelope,
): ApplicationCommandOutcome["outcome"] {
  return envelope.name === "SendTextMessage" ? "queued" : "completed";
}

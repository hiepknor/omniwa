import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
} from "@omniwa/application";
import type { ApiCredential, ApplicationInterfaceDispatcher } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import { handleApiHttpRequest, type ApiHttpResponse, type ApiKeyConfig } from "./http-server.js";

const publicCredential: ApiCredential = {
  kind: "api_key",
  keyId: "test-public-key",
  scopes: [
    "instances:read",
    "instances:write",
    "instances:connect",
    "messages:send",
    "webhooks:write",
    "health:read",
  ],
  allowedInstanceRefs: ["inst_allowed"],
};

const apiKey: ApiKeyConfig = {
  key: "test-secret",
  credential: publicCredential,
};

describe("API HTTP transport", () => {
  it("serves health through the interface adapter", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/health");

    expect(response.statusCode).toBe(200);
    expect(dispatcher.queryEnvelopes).toEqual([
      expect.objectContaining({
        name: "GetHealthStatus",
        kind: "query",
      }),
    ]);
  });

  it("rejects requests with a missing API key", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-request-id": "req-missing-auth",
          "x-correlation-id": "corr-missing-auth",
        },
      },
      {
        dispatcher,
        apiKeys: [apiKey],
        now: fixedNow,
        requestRefGenerator: () => "http-missing-auth",
      },
    );

    expect(response.statusCode).toBe(401);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "missing_or_invalid_api_key",
      details: {
        category: "authentication",
      },
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("accepts a valid API key and maps instance list to a query", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/instances");

    expect(response.statusCode).toBe(200);
    expect(dispatcher.queryEnvelopes[0]).toMatchObject({
      name: "ListInstances",
      actorRef: "api_key:test-public-key",
      requestedConsistency: "eventual_projection",
    });
  });

  it("wraps success responses in the public envelope", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/instances/inst_allowed");

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "req-test",
      "x-correlation-id": "corr-test",
    });
    expect("data" in response.body ? response.body.meta : undefined).toEqual({
      requestId: "req-test",
      correlationId: "corr-test",
      timestamp: "2026-06-30T00:00:00.000Z",
    });
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      kind: "query_outcome",
      outcome: "result",
    });
  });

  it("wraps validation failures in the public error envelope", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: "12025550123",
      },
      headers: {
        "idempotency-key": "send-text-1",
      },
    });

    expect(response.statusCode).toBe(400);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "invalid_body",
      message: "Request body requires non-empty string field 'text'.",
      details: {
        category: "validation",
      },
    });
    expect("error" in response.body ? response.body.meta.requestId : undefined).toBe("req-test");
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
  });

  it("maps send text message to the internal command without exposing command names in the URL", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: "12025550123",
        text: "hello",
      },
      headers: {
        "idempotency-key": "send-text-1",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(dispatcher.commandEnvelopes).toEqual([
      expect.objectContaining({
        name: "SendTextMessage",
        targetRef: "inst_allowed",
        actorRef: "api_key:test-public-key",
        idempotencyKey: "send-text-1",
        safeInputRef: "http:SendTextMessage:http-test",
      }),
    ]);
  });

  it("keeps routes without current projections present but explicitly partial", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/jobs");

    expect(response.statusCode).toBe(501);
    expect("error" in response.body ? response.body.error.code : undefined).toBe(
      "jobs_list_not_available",
    );
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });
});

function request(
  dispatcher: CapturingDispatcher,
  method: string,
  url: string,
  input: Readonly<{
    body?: unknown;
    headers?: Readonly<Record<string, string>>;
  }> = {},
): Promise<ApiHttpResponse> {
  return handleApiHttpRequest(
    {
      method,
      url,
      headers: {
        "x-api-key": "test-secret",
        "x-request-id": "req-test",
        "x-correlation-id": "corr-test",
        ...(input.headers ?? {}),
      },
      ...optional("body", input.body),
    },
    {
      dispatcher,
      apiKeys: [apiKey],
      now: fixedNow,
      requestRefGenerator: () => "http-test",
    },
  );
}

function fixedNow(): Date {
  return new Date("2026-06-30T00:00:00.000Z");
}

class CapturingDispatcher implements ApplicationInterfaceDispatcher {
  readonly commandEnvelopes: ApplicationCommandEnvelope[] = [];
  readonly queryEnvelopes: ApplicationQueryEnvelope[] = [];

  executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
    this.commandEnvelopes.push(envelope);

    return createApplicationCommandOutcome({
      commandRef: envelope.commandRef,
      outcome: envelope.name === "SendTextMessage" ? "queued" : "completed",
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

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

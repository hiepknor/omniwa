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

import { InMemoryFixedWindowRateLimiter } from "./api-rate-limiter.js";
import { handleApiHttpRequest, type ApiHttpResponse, type ApiKeyConfig } from "./http-server.js";
import type { ApiResourceOwnershipResolver } from "./resource-ownership.js";

const publicCredential: ApiCredential = {
  kind: "api_key",
  keyId: "platform-public-key",
  scopes: [
    "instances:read",
    "instances:write",
    "instances:connect",
    "messages:send",
    "messages:read",
    "webhooks:read",
    "webhooks:write",
    "events:read",
    "health:read",
  ],
  allowedInstanceRefs: ["inst_allowed"],
};

const monitoringCredential: ApiCredential = {
  kind: "monitoring_key",
  keyId: "platform-monitoring-key",
  scopes: ["health:read", "metrics:read", "jobs:read"],
};

const apiKeys: readonly ApiKeyConfig[] = [
  {
    key: "platform-secret",
    credential: publicCredential,
  },
  {
    key: "platform-monitoring-secret",
    credential: monitoringCredential,
  },
];

describe("platform production regression", () => {
  it("covers REST to Application dispatcher with in-memory state, queue, and provider stub", async () => {
    const dispatcher = new ProductionRegressionDispatcher();

    const created = await request(dispatcher, "POST", "/v1/instances", {
      body: { displayName: "Primary instance" },
      headers: { "idempotency-key": "create-instance-regression" },
    });
    const connected = await request(dispatcher, "POST", "/v1/instances/inst_allowed/connect", {
      body: {},
      headers: { "idempotency-key": "connect-instance-regression" },
    });
    const sent = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: "12025550123",
        text: "production regression smoke",
      },
      headers: { "idempotency-key": "send-text-regression" },
    });
    const instances = await request(dispatcher, "GET", "/v1/instances?status=connected");
    const jobs = await request(dispatcher, "GET", "/v1/jobs", {
      apiKey: "platform-monitoring-secret",
    });

    expect(created.statusCode).toBe(200);
    expect(connected.statusCode).toBe(202);
    expect(sent.statusCode).toBe(202);
    expect("data" in instances.body ? instances.body.data : undefined).toEqual([
      {
        resourceType: "instance",
        id: "inst_allowed",
        status: "connected",
        displayName: "Primary instance",
      },
    ]);
    expect("data" in jobs.body ? jobs.body.data : undefined).toEqual([
      {
        resourceType: "job",
        id: "job_connect_1",
        status: "queued",
        ownerContext: "instance",
        resourceRef: "inst_allowed",
      },
      {
        resourceType: "job",
        id: "job_message_2",
        status: "queued",
        ownerContext: "messaging",
        resourceRef: "inst_allowed",
      },
    ]);
    expect(dispatcher.commandEnvelopes.map((envelope) => envelope.name)).toEqual([
      "CreateInstance",
      "ConnectInstance",
      "SendTextMessage",
    ]);
    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "ListInstances",
      "ListWorkerJobs",
    ]);
    expect(dispatcher.providerStubRequests).toEqual([
      {
        kind: "send_text",
        instanceRef: "inst_allowed",
        safeMessageRef: "msg_regression_1",
      },
    ]);
    const publicBodies = JSON.stringify([
      created.body,
      connected.body,
      sent.body,
      instances.body,
      jobs.body,
    ]);
    expect(publicBodies).not.toContain("command_outcome");
    expect(publicBodies).not.toContain("query_outcome");
    expect(publicBodies).not.toContain("SendTextMessage");
    expect(publicBodies).not.toContain("platform-secret");
  });

  it("keeps auth, authorization, rate limit, and ownership failures blocking dispatch", async () => {
    const dispatcher = new ProductionRegressionDispatcher();
    const rateLimiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 1,
      windowMilliseconds: 60_000,
      clock: { epochMilliseconds: () => 1_800_000_000_000 },
    });
    const ownershipResolver: ApiResourceOwnershipResolver = {
      resolve: () => Promise.resolve({ status: "resolved", instanceRef: "inst_denied" }),
    };

    const missingAuth = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-request-id": "req-missing-auth",
          "x-correlation-id": "corr-missing-auth",
        },
      },
      regressionOptions(dispatcher),
    );
    const forbidden = await handleApiHttpRequest(
      {
        method: "POST",
        url: "/v1/instances/inst_allowed/messages/text",
        headers: {
          "x-api-key": "limited-secret",
          "x-request-id": "req-forbidden",
          "x-correlation-id": "corr-forbidden",
          "idempotency-key": "send-forbidden",
        },
        body: {
          to: "12025550123",
          text: "denied",
        },
      },
      regressionOptions(dispatcher, {
        apiKeysOverride: [
          {
            key: "limited-secret",
            credential: {
              kind: "api_key",
              keyId: "limited-platform-key",
              scopes: ["instances:read"],
              allowedInstanceRefs: ["inst_allowed"],
            },
          },
        ],
      }),
    );
    const rateLimitedFirst = await request(dispatcher, "GET", "/v1/instances", { rateLimiter });
    const rateLimitedSecond = await request(dispatcher, "GET", "/v1/instances", { rateLimiter });
    const ownershipDenied = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/messages/msg_1",
        headers: {
          "x-api-key": "platform-secret",
          "x-request-id": "req-owner",
          "x-correlation-id": "corr-owner",
        },
      },
      regressionOptions(dispatcher, {
        resourceOwnershipResolver: ownershipResolver,
      }),
    );

    expect(missingAuth.statusCode).toBe(401);
    expect(errorCode(missingAuth)).toBe("missing_or_invalid_api_key");
    expect(forbidden.statusCode).toBe(403);
    expect(errorCode(forbidden)).toBe("missing_scope");
    expect(rateLimitedFirst.statusCode).toBe(200);
    expect(rateLimitedSecond.statusCode).toBe(429);
    expect(errorCode(rateLimitedSecond)).toBe("rate_limit_exceeded");
    expect(ownershipDenied.statusCode).toBe(403);
    expect(errorCode(ownershipDenied)).toBe("resource_ownership_denied");
    expect(
      JSON.stringify([
        missingAuth.body,
        forbidden.body,
        rateLimitedSecond.body,
        ownershipDenied.body,
      ]),
    ).not.toContain("platform-secret");
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
    expect(dispatcher.queryEnvelopes).toHaveLength(1);
  });
});

function request(
  dispatcher: ProductionRegressionDispatcher,
  method: string,
  url: string,
  input: Readonly<{
    apiKey?: string;
    body?: unknown;
    headers?: Readonly<Record<string, string>>;
    rateLimiter?: InMemoryFixedWindowRateLimiter;
  }> = {},
): Promise<ApiHttpResponse> {
  return handleApiHttpRequest(
    {
      method,
      url,
      headers: {
        "x-api-key": input.apiKey ?? "platform-secret",
        "x-request-id": "req-platform-regression",
        "x-correlation-id": "corr-platform-regression",
        ...(input.headers ?? {}),
      },
      ...optional("body", input.body),
    },
    regressionOptions(dispatcher, {
      ...optional("rateLimiter", input.rateLimiter),
    }),
  );
}

function regressionOptions(
  dispatcher: ProductionRegressionDispatcher,
  overrides: Readonly<{
    apiKeysOverride?: readonly ApiKeyConfig[];
    rateLimiter?: InMemoryFixedWindowRateLimiter;
    resourceOwnershipResolver?: ApiResourceOwnershipResolver;
  }> = {},
) {
  return {
    dispatcher,
    apiKeys: overrides.apiKeysOverride ?? apiKeys,
    now: fixedNow,
    requestRefGenerator: () => "http-platform-regression",
    ...optional("rateLimiter", overrides.rateLimiter),
    ...optional("resourceOwnershipResolver", overrides.resourceOwnershipResolver),
  };
}

function fixedNow(): Date {
  return new Date("2026-07-01T00:00:00.000Z");
}

function errorCode(response: ApiHttpResponse): string | undefined {
  return "error" in response.body ? response.body.error.code : undefined;
}

class ProductionRegressionDispatcher implements ApplicationInterfaceDispatcher {
  readonly commandEnvelopes: ApplicationCommandEnvelope[] = [];
  readonly queryEnvelopes: ApplicationQueryEnvelope[] = [];
  readonly providerStubRequests: Array<
    Readonly<{ kind: "send_text"; instanceRef: string; safeMessageRef: string }>
  > = [];
  private readonly instances = new Map<string, RegressionInstance>();
  private readonly jobs: RegressionJob[] = [];

  executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
    this.commandEnvelopes.push(envelope);

    switch (envelope.name) {
      case "CreateInstance":
        this.instances.set("inst_allowed", {
          instanceId: "inst_allowed",
          displayName: "Primary instance",
          status: "created",
        });
        return this.outcome(envelope, "completed", "inst_allowed");
      case "ConnectInstance":
        this.updateInstanceStatus(envelope.targetRef, "connected");
        return this.queueOutcome(envelope, "instance", "job_connect_1");
      case "SendTextMessage":
        this.providerStubRequests.push({
          kind: "send_text",
          instanceRef: envelope.targetRef ?? "unknown",
          safeMessageRef: "msg_regression_1",
        });
        return this.queueOutcome(envelope, "messaging", "job_message_2", "msg_regression_1");
      default:
        return this.outcome(envelope, "completed", `${envelope.commandRef}:result`);
    }
  }

  executeQuery(envelope: ApplicationQueryEnvelope): ApplicationQueryOutcome {
    this.queryEnvelopes.push(envelope);

    if (envelope.name === "ListInstances") {
      return this.queryOutcome(envelope, {
        items: [...this.instances.values()].filter((instance) => instance.status === "connected"),
      });
    }

    if (envelope.name === "ListWorkerJobs") {
      return this.queryOutcome(envelope, { items: this.jobs });
    }

    return this.queryOutcome(envelope, {
      resultRef: envelope.targetRef ?? `${envelope.queryRef}:result`,
    });
  }

  private updateInstanceStatus(instanceRef: string | undefined, status: string): void {
    if (instanceRef === undefined) {
      return;
    }

    const current = this.instances.get(instanceRef);
    if (current !== undefined) {
      this.instances.set(instanceRef, { ...current, status });
    }
  }

  private queueOutcome(
    envelope: ApplicationCommandEnvelope,
    owner: string,
    jobId: string,
    resultRef = jobId,
  ): ApplicationCommandOutcome {
    this.jobs.push({
      jobId,
      owner,
      status: "queued",
      targetRef: envelope.targetRef ?? "unknown",
    });

    return this.outcome(envelope, "queued", resultRef);
  }

  private outcome(
    envelope: ApplicationCommandEnvelope,
    outcome: "completed" | "queued",
    resultRef: string,
  ): ApplicationCommandOutcome {
    return createApplicationCommandOutcome({
      commandRef: envelope.commandRef,
      outcome,
      accepted: true,
      retryable: false,
      resultRef,
    });
  }

  private queryOutcome(
    envelope: ApplicationQueryEnvelope,
    data: Readonly<Record<string, unknown>>,
  ): ApplicationQueryOutcome {
    return {
      ...createApplicationQueryOutcome({
        queryRef: envelope.queryRef,
        outcome: "result",
        consistency: envelope.requestedConsistency ?? "eventual_projection",
        freshness: {
          stale: false,
          refreshedAtEpochMilliseconds: 1_800_000_000_000,
        },
        resultRef: envelope.targetRef ?? `${envelope.queryRef}:result`,
      }),
      ...data,
    };
  }
}

type RegressionInstance = Readonly<{
  instanceId: string;
  displayName: string;
  status: string;
}>;

type RegressionJob = Readonly<{
  jobId: string;
  owner: string;
  status: string;
  targetRef: string;
}>;

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

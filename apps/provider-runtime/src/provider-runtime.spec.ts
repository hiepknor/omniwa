import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type MessagingProviderPort,
  type ProviderCapabilitySummary,
  type ProviderConnectionRequest,
  type ProviderConnectionResult,
  type ProviderOutboundMessageRequest,
  type ProviderOutboundMessageResult,
  type ProviderQrPairingChallenge,
  type ProviderQrPairingRequest,
} from "@omniwa/application";
import {
  SecretValue,
  createSecretName,
  type SecretDescriptor,
  type SecretProvider,
} from "@omniwa/config";
import {
  createFailureCategory,
  createInstanceId,
  createMessageType,
  createProviderId,
  createSessionId,
  type FailureCategory,
} from "@omniwa/domain";
import { fail, type OmniwaError } from "@omniwa/errors";
import type {
  LogEntry,
  MetricPoint,
  MetricRecorder,
  StructuredLogger,
} from "@omniwa/observability";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  err,
  ok,
  type Result,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  InMemoryProviderRuntimeOwnershipGuard,
  ProviderRuntime,
  providerRuntimeSessionSecretPurpose,
} from "./provider-runtime.js";

const instanceId = createInstanceId("provider-runtime-instance");
const providerId = createProviderId("baileys");
const sessionId = createSessionId("provider-runtime-session");
const sessionSecretName = createSecretName("OMNIWA_TEST_SESSION_SECRET");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-runtime-correlation"),
    requestId: createRequestId("provider-runtime-request"),
  }),
  actorRef: "provider-runtime-test",
};

describe("ProviderRuntime", () => {
  it("connects through MessagingProviderPort after restoring a session secret", async () => {
    const provider = new FakeMessagingProvider({
      connectionState: "connected",
    });
    const secrets = new FakeSecretProvider({
      [String(sessionSecretName)]: "synthetic-session-secret",
    });
    const telemetry = new RecordingTelemetry();
    const runtime = new ProviderRuntime({
      provider,
      secretProvider: secrets,
      ownerRef: "runtime-a",
      logger: telemetry,
      metrics: telemetry,
    });

    const result = await runtime.connect(
      {
        instanceId,
        providerId,
        sessionId,
        sessionSecretName,
        reasonCode: "test_connect",
      },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      state: "connected",
    });
    expect(provider.connectionRequests).toEqual([
      expect.objectContaining({
        instanceId,
        providerId,
        sessionId,
        intent: "connect",
        reasonCode: "test_connect",
      }),
    ]);
    expect(secrets.reads).toEqual([
      {
        name: sessionSecretName,
        purpose: providerRuntimeSessionSecretPurpose,
      },
    ]);
    expect(runtime.snapshot().instances).toEqual([
      expect.objectContaining({
        instanceId,
        providerId,
        ownerRef: "runtime-a",
        state: "connected",
      }),
    ]);
    expect(telemetry.metrics).toEqual([
      expect.objectContaining({
        name: "provider_runtime.operation.total",
        labels: expect.objectContaining({
          operation: "connect",
          outcome: "success",
          state: "connected",
        }),
      }),
    ]);
  });

  it("rejects duplicate active provider runtime ownership for an instance", async () => {
    const guard = new InMemoryProviderRuntimeOwnershipGuard();
    const providerA = new FakeMessagingProvider({
      connectionState: "connected",
    });
    const providerB = new FakeMessagingProvider({
      connectionState: "connected",
    });
    const runtimeA = new ProviderRuntime({
      provider: providerA,
      secretProvider: new FakeSecretProvider(),
      ownershipGuard: guard,
      ownerRef: "runtime-a",
    });
    const runtimeB = new ProviderRuntime({
      provider: providerB,
      secretProvider: new FakeSecretProvider(),
      ownershipGuard: guard,
      ownerRef: "runtime-b",
    });

    await runtimeA.connect(
      {
        instanceId,
        providerId,
        reasonCode: "test_connect",
      },
      context,
    );
    const rejected = await runtimeB.connect(
      {
        instanceId,
        providerId,
        reasonCode: "test_duplicate_connect",
      },
      context,
    );

    expect(rejected).toMatchObject({
      ok: false,
      state: "action_required",
      failure: {
        code: "provider_runtime_already_active",
        source: "runtime",
      },
    });
    expect(providerB.connectionRequests).toHaveLength(0);
    expect(guard.currentOwner(instanceId)).toBe("runtime-a");
  });

  it("disconnects through the provider and releases active ownership", async () => {
    const guard = new InMemoryProviderRuntimeOwnershipGuard();
    const provider = new FakeMessagingProvider({
      connectionState: "connected",
    });
    const runtime = new ProviderRuntime({
      provider,
      secretProvider: new FakeSecretProvider(),
      ownershipGuard: guard,
      ownerRef: "runtime-a",
    });

    await runtime.connect(
      {
        instanceId,
        providerId,
        reasonCode: "test_connect",
      },
      context,
    );
    const disconnected = await runtime.disconnect(
      {
        instanceId,
        providerId,
        reasonCode: "test_disconnect",
      },
      context,
    );

    expect(disconnected).toMatchObject({
      ok: true,
      state: "disconnected",
    });
    expect(provider.disconnectRequests).toEqual([
      expect.objectContaining({
        instanceId,
        providerId,
        intent: "disconnect",
        reasonCode: "test_disconnect",
      }),
    ]);
    expect(guard.currentOwner(instanceId)).toBeUndefined();
  });

  it("enters action_required without calling the provider when session secret restore fails", async () => {
    const provider = new FakeMessagingProvider({
      connectionState: "connected",
    });
    const runtime = new ProviderRuntime({
      provider,
      secretProvider: new FakeSecretProvider(),
      ownerRef: "runtime-a",
    });

    const result = await runtime.connect(
      {
        instanceId,
        providerId,
        sessionId,
        sessionSecretName,
        reasonCode: "test_connect",
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      state: "action_required",
      failure: {
        code: "secret_not_found",
        source: "secret",
        failureCategory: "configuration",
      },
    });
    expect(provider.connectionRequests).toHaveLength(0);
    expect(runtime.snapshot().instances).toEqual([
      expect.objectContaining({
        state: "action_required",
        failure: expect.objectContaining({
          source: "secret",
        }),
      }),
    ]);
  });

  it("classifies provider failures without exposing provider-native payloads", async () => {
    const provider = new FakeMessagingProvider({
      connectionFailure: providerFailure("provider_network_timeout", true, "network"),
    });
    const runtime = new ProviderRuntime({
      provider,
      secretProvider: new FakeSecretProvider(),
      ownerRef: "runtime-a",
    });

    const result = await runtime.connect(
      {
        instanceId,
        providerId,
        reasonCode: "test_connect",
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      state: "failed",
      failure: {
        source: "provider",
        code: "provider_network_timeout",
        retryable: true,
        failureCategory: "network",
      },
    });
  });

  it("requests QR pairing through the provider while keeping challenge data classified as secret", async () => {
    const provider = new FakeMessagingProvider({
      qrChallengeRef: "qr-challenge-ref",
    });
    const secrets = new FakeSecretProvider({
      [String(sessionSecretName)]: "synthetic-session-secret",
    });
    const runtime = new ProviderRuntime({
      provider,
      secretProvider: secrets,
      ownerRef: "runtime-a",
    });

    const result = await runtime.requestQrPairing(
      {
        instanceId,
        providerId,
        sessionId,
        sessionSecretName,
        pairingAttemptRef: "pairing-attempt-1",
      },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      state: "qr_required",
      value: {
        challengeRef: "qr-challenge-ref",
        dataClassification: "secret",
      },
    });
    expect(provider.qrRequests).toEqual([
      expect.objectContaining({
        instanceId,
        providerId,
        sessionId,
        pairingAttemptRef: "pairing-attempt-1",
      }),
    ]);
    expect(runtime.snapshot().instances).toEqual([
      expect.objectContaining({
        state: "qr_required",
      }),
    ]);
  });
});

class FakeMessagingProvider implements MessagingProviderPort {
  readonly connectionRequests: ProviderConnectionRequest[] = [];
  readonly disconnectRequests: ProviderConnectionRequest[] = [];
  readonly qrRequests: ProviderQrPairingRequest[] = [];
  private readonly connectionState: ProviderConnectionResult["state"];
  private readonly connectionFailure: ApplicationPortFailure | undefined;
  private readonly qrChallengeRef: string;

  constructor(
    options: Readonly<{
      connectionState?: ProviderConnectionResult["state"];
      connectionFailure?: ApplicationPortFailure;
      qrChallengeRef?: string;
    }> = {},
  ) {
    this.connectionState = options.connectionState ?? "connected";
    this.connectionFailure = options.connectionFailure;
    this.qrChallengeRef = options.qrChallengeRef ?? "qr-challenge";
  }

  requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    void context;
    this.connectionRequests.push(request);

    if (this.connectionFailure !== undefined) {
      return Promise.resolve(err(this.connectionFailure));
    }

    return Promise.resolve(
      ok(
        Object.freeze({
          instanceId: request.instanceId,
          providerId: request.providerId,
          state: this.connectionState,
          providerSignalRef: `${String(request.providerId)}.${this.connectionState}`,
        }),
      ),
    );
  }

  requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> {
    void context;
    this.qrRequests.push(request);

    return Promise.resolve(
      ok(
        Object.freeze({
          instanceId: request.instanceId,
          sessionId: request.sessionId,
          challengeRef: this.qrChallengeRef,
          dataClassification: "secret",
        }),
      ),
    );
  }

  disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    void context;
    this.disconnectRequests.push(request);

    return Promise.resolve(
      ok(
        Object.freeze({
          instanceId: request.instanceId,
          providerId: request.providerId,
          state: "disconnected",
          providerSignalRef: `${String(request.providerId)}.disconnected`,
        }),
      ),
    );
  }

  sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> {
    void context;

    return Promise.resolve(
      ok(
        Object.freeze({
          messageId: request.messageId,
          status: "accepted",
          retryable: false,
          providerReceiptRef: `${String(request.messageId)}.receipt`,
        }),
      ),
    );
  }

  getCapabilitySummary(
    providerId: ProviderQrPairingRequest["providerId"],
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    void context;

    return Promise.resolve(
      ok(
        Object.freeze({
          providerId,
          supportedMessageTypes: Object.freeze([createMessageType("text")]),
          degraded: false,
        }),
      ),
    );
  }
}

class FakeSecretProvider implements SecretProvider {
  readonly reads: SecretDescriptor[] = [];
  private readonly secretsByName: Readonly<Record<string, string>>;

  constructor(secretsByName: Readonly<Record<string, string>> = {}) {
    this.secretsByName = secretsByName;
  }

  readSecret(descriptor: SecretDescriptor): Promise<Result<SecretValue, OmniwaError>> {
    this.reads.push(descriptor);
    const rawSecret = this.secretsByName[String(descriptor.name)];

    if (rawSecret === undefined) {
      return Promise.resolve(
        fail({
          category: "configuration",
          code: "secret_not_found",
          message: "Required secret is not available.",
          retryable: false,
          metadata: {
            secretName: String(descriptor.name),
          },
        }),
      );
    }

    return Promise.resolve(ok(SecretValue.fromString(rawSecret)));
  }
}

class RecordingTelemetry implements MetricRecorder, StructuredLogger {
  readonly metrics: MetricPoint[] = [];
  readonly logs: LogEntry[] = [];

  recordMetric(point: MetricPoint): void {
    this.metrics.push(point);
  }

  write(entry: LogEntry): void {
    this.logs.push(entry);
  }
}

function providerFailure(
  code: string,
  retryable: boolean,
  failureCategory: FailureCategory,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: retryable ? "timeout" : "rejected",
    code,
    message: "Provider failed.",
    retryable,
    ownerContext: "provider_integration",
    failureCategory: createFailureCategory(failureCategory),
  });
}

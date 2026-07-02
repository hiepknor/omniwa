import {
  type ApplicationPortContext,
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
  createInstanceId,
  createMessageType,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import type { OmniwaError } from "@omniwa/errors";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  ok,
  type Result,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  createProviderRuntimeApp,
  createProviderRuntimeContext,
  providerRuntimeAppActorRef,
  ProviderRuntimeApp,
} from "./provider-runtime-app.js";
import { ProviderRuntime } from "./provider-runtime.js";

const instanceId = createInstanceId("provider-app-instance");
const providerId = createProviderId("baileys");
const sessionId = createSessionId("provider-app-session");
const sessionSecretName = createSecretName("OMNIWA_PROVIDER_APP_SESSION_SECRET");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-app-correlation"),
    requestId: createRequestId("provider-app-request"),
  }),
  actorRef: "provider-runtime-app-test",
  dataClassification: "internal",
};

describe("ProviderRuntimeApp", () => {
  it("runs connect and reconnect lifecycle commands through ProviderRuntime", async () => {
    const provider = new FakeMessagingProvider();
    const app = createProviderRuntimeApp({
      provider,
      secretProvider: new FakeSecretProvider({
        [String(sessionSecretName)]: "synthetic-session-secret",
      }),
      ownerRef: "provider-app-owner",
      contextFactory: () => context,
    });

    const connected = await app.runOnce({
      action: "connect",
      input: {
        instanceId,
        providerId,
        sessionId,
        sessionSecretName,
        reasonCode: "provider_app_connect",
      },
    });
    const reconnected = await app.runOnce({
      action: "reconnect",
      input: {
        instanceId,
        providerId,
        sessionId,
        reasonCode: "provider_app_reconnect",
      },
    });

    expect(connected).toMatchObject({
      action: "connect",
      result: {
        ok: true,
        state: "connected",
      },
      snapshot: {
        ownerRef: "provider-app-owner",
      },
    });
    expect(reconnected).toMatchObject({
      action: "reconnect",
      result: {
        ok: true,
        state: "connected",
      },
    });
    expect(provider.connectionRequests).toEqual([
      expect.objectContaining({
        intent: "connect",
        reasonCode: "provider_app_connect",
      }),
      expect.objectContaining({
        intent: "reconnect",
        reasonCode: "provider_app_reconnect",
      }),
    ]);
    expect(reconnected.snapshot.signals).toEqual([
      expect.objectContaining({
        operation: "connect",
        kind: "connection",
      }),
      expect.objectContaining({
        operation: "reconnect",
        kind: "connection",
      }),
    ]);
  });

  it("runs QR pairing and disconnect commands without exposing session secret material", async () => {
    const provider = new FakeMessagingProvider();
    const app = createProviderRuntimeApp({
      provider,
      secretProvider: new FakeSecretProvider({
        [String(sessionSecretName)]: "synthetic-session-secret",
      }),
      contextFactory: () => context,
    });

    const pairing = await app.runOnce({
      action: "request_qr_pairing",
      input: {
        instanceId,
        providerId,
        sessionId,
        sessionSecretName,
        pairingAttemptRef: "pairing-app-attempt",
      },
    });
    const disconnected = await app.runOnce({
      action: "disconnect",
      input: {
        instanceId,
        providerId,
        sessionId,
        reasonCode: "provider_app_disconnect",
      },
    });

    expect(pairing.result).toMatchObject({
      ok: true,
      state: "qr_required",
      value: {
        dataClassification: "secret",
      },
    });
    expect(disconnected.result).toMatchObject({
      ok: true,
      state: "disconnected",
    });
    expect(JSON.stringify([pairing, disconnected])).not.toContain("synthetic-session-secret");
    expect(disconnected.snapshot.signals).toEqual([
      expect.objectContaining({
        kind: "auth",
        runtimeState: "qr_required",
        dataClassification: "confidential",
      }),
      expect.objectContaining({
        kind: "connection",
        runtimeState: "disconnected",
      }),
    ]);
  });

  it("creates safe provider runtime app contexts", () => {
    const generated = createProviderRuntimeContext();

    expect(generated.actorRef).toBe(providerRuntimeAppActorRef);
    expect(String(generated.requestContext.requestId)).toMatch(/^provider-runtime:/u);
    expect(String(generated.requestContext.correlationId)).toMatch(/^provider-runtime:/u);
    expect(generated.dataClassification).toBe("internal");
  });

  it("can wrap an existing ProviderRuntime instance", async () => {
    const provider = new FakeMessagingProvider();
    const app = new ProviderRuntimeApp({
      runtime: new ProviderRuntime({
        provider,
        secretProvider: new FakeSecretProvider(),
        ownerRef: "existing-runtime",
      }),
      contextFactory: () => context,
    });

    const result = await app.runOnce({
      action: "connect",
      input: {
        instanceId,
        providerId,
        reasonCode: "existing_runtime_connect",
      },
    });

    expect(result.snapshot.ownerRef).toBe("existing-runtime");
    expect(provider.connectionRequests).toHaveLength(1);
  });
});

class FakeMessagingProvider implements MessagingProviderPort {
  readonly connectionRequests: ProviderConnectionRequest[] = [];
  readonly disconnectRequests: ProviderConnectionRequest[] = [];
  readonly qrRequests: ProviderQrPairingRequest[] = [];

  requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    void context;
    this.connectionRequests.push(request);

    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        providerId: request.providerId,
        state: "connected",
        providerSignalRef: `${String(request.providerId)}.${request.intent}.connected`,
      }),
    );
  }

  requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> {
    void context;
    this.qrRequests.push(request);

    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        sessionId: request.sessionId,
        challengeRef: "qr-app-challenge",
        dataClassification: "secret",
      }),
    );
  }

  disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    void context;
    this.disconnectRequests.push(request);

    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        providerId: request.providerId,
        state: "disconnected",
        providerSignalRef: `${String(request.providerId)}.disconnected`,
      }),
    );
  }

  sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> {
    void context;

    return Promise.resolve(
      ok({
        messageId: request.messageId,
        status: "accepted",
        retryable: false,
      }),
    );
  }

  getCapabilitySummary(
    providerId: ProviderConnectionRequest["providerId"],
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    void context;

    return Promise.resolve(
      ok({
        providerId,
        supportedMessageTypes: [createMessageType("text")],
        degraded: false,
      }),
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
    const rawSecret = this.secretsByName[String(descriptor.name)] ?? "default-secret";

    return Promise.resolve(ok(SecretValue.fromString(rawSecret)));
  }
}

import {
  createApplicationPortFailure,
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
  createInstanceId,
  createMessageId,
  createMessageType,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import type { ProviderCommand } from "@omniwa/infrastructure-provider-bridge";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  err,
  ok,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  ProviderRuntimeCommandReceiver,
  type ProviderRuntimeSessionStarter,
} from "./provider-command-receiver.js";
import type { ProviderRuntimeApp, ProviderRuntimeAppResult } from "./provider-runtime-app.js";
import type {
  ProviderRuntimeSupervisorSessionSnapshot,
  ProviderRuntimeSupervisorStartInput,
  ProviderRuntimeSupervisorStopInput,
} from "./provider-runtime-supervisor.js";

const instanceId = createInstanceId("bridge-receiver-instance");
const providerId = createProviderId("baileys");
const sessionId = createSessionId("bridge-receiver-session");
const messageId = createMessageId("bridge-receiver-message");
const context: ApplicationPortContext = {
  actorRef: "provider-runtime-command-receiver-test",
  dataClassification: "internal",
  idempotencyKey: "receiver-test",
  requestContext: createRequestContext({
    correlationId: createCorrelationId("bridge-receiver-correlation"),
    requestId: createRequestId("bridge-receiver-request"),
  }),
};

describe("ProviderRuntimeCommandReceiver", () => {
  it("routes connection, QR, and disconnect commands through ProviderRuntimeApp", async () => {
    const app = new RecordingProviderRuntimeApp();
    const provider = new RecordingMessagingProvider();
    const receiver = new ProviderRuntimeCommandReceiver({ app, provider });

    const connected = await receiver.execute(connectionCommand("connect"), context);
    const reconnected = await receiver.execute(connectionCommand("reconnect"), context);
    const qr = await receiver.execute(qrCommand(), context);
    const disconnected = await receiver.execute(disconnectCommand(), context);

    expect(connected.ok ? connected.value.kind : undefined).toBe("request_connection");
    expect(reconnected.ok ? reconnected.value.kind : undefined).toBe("request_connection");
    expect(qr.ok ? qr.value.kind : undefined).toBe("request_qr_pairing");
    expect(disconnected.ok ? disconnected.value.kind : undefined).toBe("disconnect");
    expect(app.actions).toEqual(["connect", "reconnect", "request_qr_pairing", "disconnect"]);
    expect(provider.outboundRequests).toHaveLength(0);
  });

  it("starts the provider session through the supervisor for connect intent", async () => {
    const app = new RecordingProviderRuntimeApp();
    const supervisor = new RecordingSessionStarter();
    const receiver = new ProviderRuntimeCommandReceiver({
      app,
      provider: new RecordingMessagingProvider(),
      supervisor,
    });

    const result = await receiver.execute(connectionCommand("connect"), context);

    expect(result.ok ? result.value : undefined).toEqual({
      kind: "request_connection",
      result: {
        instanceId,
        providerId,
        providerSignalRef: "signal.safe-ref",
        state: "qr_required",
      },
    });
    expect(supervisor.startInputs).toEqual([
      {
        instanceId,
        providerId,
        reasonCode: "receiver.connect",
        sessionId,
      },
    ]);
    expect(app.actions).toEqual([]);
  });

  it("stops the provider session through the supervisor for disconnect intent", async () => {
    const app = new RecordingProviderRuntimeApp();
    const supervisor = new RecordingSessionStarter();
    const receiver = new ProviderRuntimeCommandReceiver({
      app,
      provider: new RecordingMessagingProvider(),
      supervisor,
    });

    const result = await receiver.execute(disconnectCommand(), context);

    expect(result.ok ? result.value : undefined).toEqual({
      kind: "disconnect",
      result: {
        instanceId,
        providerId,
        providerSignalRef: "signal.disconnected.safe-ref",
        state: "disconnected",
      },
    });
    expect(supervisor.stopInputs).toEqual([
      {
        instanceId,
        providerId,
        reasonCode: "receiver.disconnect",
        sessionId,
      },
    ]);
    expect(app.actions).toEqual([]);
  });

  it("falls back to the runtime connect path when the supervisor already owns the session", async () => {
    const app = new RecordingProviderRuntimeApp();
    const supervisor = new RecordingSessionStarter({
      failWithCode: "provider_runtime_supervisor_session_already_active",
    });
    const receiver = new ProviderRuntimeCommandReceiver({
      app,
      provider: new RecordingMessagingProvider(),
      supervisor,
    });

    const result = await receiver.execute(connectionCommand("connect"), context);

    expect(result.ok ? result.value.kind : undefined).toBe("request_connection");
    expect(app.actions).toEqual(["connect"]);
  });

  it("propagates non-duplicate supervisor start failures", async () => {
    const app = new RecordingProviderRuntimeApp();
    const supervisor = new RecordingSessionStarter({
      failWithCode: "provider_runtime_supervisor_start_failed",
    });
    const receiver = new ProviderRuntimeCommandReceiver({
      app,
      provider: new RecordingMessagingProvider(),
      supervisor,
    });

    const result = await receiver.execute(connectionCommand("connect"), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe(
      "provider_runtime_supervisor_start_failed",
    );
    expect(app.actions).toEqual([]);
  });

  it("does not serialize app or provider dependencies", () => {
    const receiver = new ProviderRuntimeCommandReceiver({
      app: new RecordingProviderRuntimeApp(),
      provider: new RecordingMessagingProvider(),
    });

    expect(JSON.stringify(receiver)).toBe("{}");
  });

  it("routes outbound send and capability commands through MessagingProviderPort", async () => {
    const app = new RecordingProviderRuntimeApp();
    const provider = new RecordingMessagingProvider();
    const receiver = new ProviderRuntimeCommandReceiver({ app, provider });

    const sent = await receiver.execute(sendCommand(), context);
    const capability = await receiver.execute(capabilityCommand(), context);

    expect(sent.ok ? sent.value : undefined).toEqual({
      kind: "send_outbound_message",
      result: {
        messageId,
        providerReceiptRef: "receipt.safe-ref",
        retryable: false,
        status: "accepted",
      },
    });
    expect(capability.ok ? capability.value.kind : undefined).toBe("get_capability_summary");
    expect(app.actions).toEqual([]);
    expect(provider.outboundRequests).toEqual([
      expect.objectContaining({
        messageId,
        outboundIntentRef: "outbound.intent.safe-ref",
      }),
    ]);
    expect(JSON.stringify(provider.outboundRequests)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(provider.outboundRequests)).not.toContain("hello");
  });

  it("rejects invalid connection intent safely", async () => {
    const app = new RecordingProviderRuntimeApp();
    const receiver = new ProviderRuntimeCommandReceiver({
      app,
      provider: new RecordingMessagingProvider(),
    });

    const result = await receiver.execute(connectionCommand("disconnect"), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe(
      "provider_command_connection_intent_invalid",
    );
    expect(app.actions).toEqual([]);
  });

  it("maps runtime failures to safe ApplicationPort failures", async () => {
    const app = new RecordingProviderRuntimeApp({
      failNextRuntimeCommand: true,
    });
    const receiver = new ProviderRuntimeCommandReceiver({
      app,
      provider: new RecordingMessagingProvider(),
    });

    const result = await receiver.execute(connectionCommand("connect"), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toEqual({
      category: "rejected",
      code: "provider_runtime_secret_unavailable",
      failureCategory: "configuration",
      message: "Provider runtime command failed.",
      retryable: false,
      safeMetadata: {
        runtimeSource: "secret",
        runtimeState: "action_required",
      },
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-session-secret");
  });

  it("passes provider failures through without raw payload exposure", async () => {
    const provider = new RecordingMessagingProvider({
      failOutbound: true,
    });
    const receiver = new ProviderRuntimeCommandReceiver({
      app: new RecordingProviderRuntimeApp(),
      provider,
    });

    const result = await receiver.execute(sendCommand(), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("provider_bridge_send_unavailable");
    expect(JSON.stringify(result)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(result)).not.toContain("hello");
  });
});

class RecordingProviderRuntimeApp implements Pick<ProviderRuntimeApp, "runOnce"> {
  readonly actions: string[] = [];
  private readonly failNextRuntimeCommand: boolean;

  constructor(options: Readonly<{ failNextRuntimeCommand?: boolean }> = {}) {
    this.failNextRuntimeCommand = options.failNextRuntimeCommand ?? false;
  }

  runOnce(
    command: Parameters<ProviderRuntimeApp["runOnce"]>[0],
    commandContext?: ApplicationPortContext,
  ): Promise<ProviderRuntimeAppResult> {
    void commandContext;
    this.actions.push(command.action);

    if (this.failNextRuntimeCommand) {
      return Promise.resolve({
        action: command.action,
        result: {
          failure: {
            category: "configuration",
            code: "provider_runtime_secret_unavailable",
            failureCategory: "configuration",
            message: "synthetic-session-secret",
            retryable: false,
            source: "secret",
          },
          ok: false,
          state: "action_required",
        },
        snapshot: {
          instances: [],
          ownerRef: "receiver-test",
          signals: [],
        },
      });
    }

    switch (command.action) {
      case "connect":
      case "reconnect":
        return Promise.resolve({
          action: command.action,
          result: {
            ok: true,
            state: "connected",
            value: {
              instanceId: command.input.instanceId,
              providerId: command.input.providerId,
              state: "connected",
            },
          },
          snapshot: {
            instances: [],
            ownerRef: "receiver-test",
            signals: [],
          },
        });
      case "request_qr_pairing":
        return Promise.resolve({
          action: command.action,
          result: {
            ok: true,
            state: "qr_required",
            value: {
              challengeRef: "challenge.safe-ref",
              dataClassification: "secret",
              instanceId: command.input.instanceId,
              sessionId: command.input.sessionId,
            },
          },
          snapshot: {
            instances: [],
            ownerRef: "receiver-test",
            signals: [],
          },
        });
      case "disconnect":
        return Promise.resolve({
          action: command.action,
          result: {
            ok: true,
            state: "disconnected",
            value: {
              instanceId: command.input.instanceId,
              providerId: command.input.providerId,
              state: "disconnected",
            },
          },
          snapshot: {
            instances: [],
            ownerRef: "receiver-test",
            signals: [],
          },
        });
    }
  }
}

class RecordingMessagingProvider implements MessagingProviderPort {
  readonly outboundRequests: ProviderOutboundMessageRequest[] = [];
  private readonly failOutbound: boolean;

  constructor(options: Readonly<{ failOutbound?: boolean }> = {}) {
    this.failOutbound = options.failOutbound ?? false;
  }

  requestConnection(
    request: ProviderConnectionRequest,
    commandContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    void commandContext;

    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        providerId: request.providerId,
        state: "connected",
      }),
    );
  }

  requestQrPairing(
    request: ProviderQrPairingRequest,
    commandContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> {
    void commandContext;

    return Promise.resolve(
      ok({
        challengeRef: "challenge.safe-ref",
        dataClassification: "secret",
        instanceId: request.instanceId,
        sessionId: request.sessionId,
      }),
    );
  }

  disconnect(
    request: ProviderConnectionRequest,
    commandContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    void commandContext;

    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        providerId: request.providerId,
        state: "disconnected",
      }),
    );
  }

  sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    commandContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> {
    void commandContext;
    this.outboundRequests.push(request);

    if (this.failOutbound) {
      return Promise.resolve(
        err({
          category: "unavailable",
          code: "provider_bridge_send_unavailable",
          message: "Provider command send failed.",
          retryable: true,
        }),
      );
    }

    return Promise.resolve(
      ok({
        messageId: request.messageId,
        providerReceiptRef: "receipt.safe-ref",
        retryable: false,
        status: "accepted",
      }),
    );
  }

  getCapabilitySummary(
    summaryProviderId: typeof providerId,
    commandContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    void commandContext;

    return Promise.resolve(
      ok({
        degraded: false,
        providerId: summaryProviderId,
        supportedMessageTypes: ["text"],
      }),
    );
  }
}

class RecordingSessionStarter implements ProviderRuntimeSessionStarter {
  readonly startInputs: ProviderRuntimeSupervisorStartInput[] = [];
  readonly stopInputs: ProviderRuntimeSupervisorStopInput[] = [];
  private readonly failWithCode: string | undefined;

  constructor(options: Readonly<{ failWithCode?: string }> = {}) {
    this.failWithCode = options.failWithCode;
  }

  startSession(
    input: ProviderRuntimeSupervisorStartInput,
    startContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorSessionSnapshot>> {
    void startContext;
    this.startInputs.push(input);

    if (this.failWithCode !== undefined) {
      return Promise.resolve(
        err(
          createApplicationPortFailure({
            category: "conflict",
            code: this.failWithCode,
            message: "Supervisor session start failed.",
            retryable: true,
          }),
        ),
      );
    }

    return Promise.resolve(
      ok({
        instanceId: input.instanceId,
        lastSignalRef: "signal.safe-ref",
        ownerRef: "receiver-test",
        providerId: input.providerId,
        sessionId: input.sessionId,
        state: "PAIRING",
        transitions: ["CREATED", "STARTING", "PAIRING"],
      }),
    );
  }

  stopSession(
    input: ProviderRuntimeSupervisorStopInput,
    stopContext: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorSessionSnapshot>> {
    void stopContext;
    this.stopInputs.push(input);

    if (this.failWithCode !== undefined) {
      return Promise.resolve(
        err(
          createApplicationPortFailure({
            category: "conflict",
            code: this.failWithCode,
            message: "Supervisor session stop failed.",
            retryable: true,
          }),
        ),
      );
    }

    return Promise.resolve(
      ok({
        instanceId: input.instanceId,
        lastSignalRef: "signal.disconnected.safe-ref",
        ownerRef: "receiver-test",
        providerId: input.providerId,
        sessionId: input.sessionId,
        state: "DESTROYED",
        transitions: ["CREATED", "STARTING", "CONNECTED", "DESTROYED"],
      }),
    );
  }
}

function connectionCommand(intent: ProviderConnectionRequest["intent"]): ProviderCommand {
  return {
    commandId: `connection.${intent}`,
    kind: "request_connection",
    request: {
      instanceId,
      intent,
      providerId,
      reasonCode: `receiver.${intent}`,
      sessionId,
    },
  };
}

function qrCommand(): ProviderCommand {
  return {
    commandId: "qr",
    kind: "request_qr_pairing",
    request: {
      instanceId,
      pairingAttemptRef: "pairing.safe-ref",
      providerId,
      sessionId,
    },
  };
}

function disconnectCommand(): ProviderCommand {
  return {
    commandId: "disconnect",
    kind: "disconnect",
    request: {
      instanceId,
      intent: "disconnect",
      providerId,
      reasonCode: "receiver.disconnect",
      sessionId,
    },
  };
}

function sendCommand(): ProviderCommand {
  return {
    commandId: "send",
    kind: "send_outbound_message",
    request: {
      idempotencyKey: "idem.safe-ref",
      instanceId,
      messageId,
      messageType: createMessageType("text"),
      outboundIntentRef: "outbound.intent.safe-ref",
      providerId,
      sessionId,
    },
  };
}

function capabilityCommand(): ProviderCommand {
  return {
    commandId: "capability",
    kind: "get_capability_summary",
    providerId,
  };
}

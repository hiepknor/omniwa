import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type MessagingProviderPort,
  type ProviderConnectionResult,
  type ProviderConnectionState,
  type ProviderQrPairingChallenge,
} from "@omniwa/application";
import type {
  ProviderCommand,
  ProviderCommandOutcome,
  ProviderCommandTransport,
} from "@omniwa/infrastructure-provider-bridge";
import { err, ok } from "@omniwa/shared";

import type { ProviderRuntimeApp, ProviderRuntimeAppCommand } from "./provider-runtime-app.js";
import type { ProviderRuntimeFailure, ProviderRuntimeLifecycleState } from "./provider-runtime.js";
import type {
  ProviderRuntimeSupervisorSessionSnapshot,
  ProviderRuntimeSupervisorStartInput,
  ProviderRuntimeSupervisorStopInput,
  ProviderRuntimeSupervisorState,
} from "./provider-runtime-supervisor.js";

export type ProviderRuntimeSessionStarter = Readonly<{
  startSession(
    input: ProviderRuntimeSupervisorStartInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorSessionSnapshot>>;
  stopSession?(
    input: ProviderRuntimeSupervisorStopInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorSessionSnapshot>>;
}>;

export type ProviderRuntimeCommandReceiverOptions = Readonly<{
  app: Pick<ProviderRuntimeApp, "runOnce">;
  provider: MessagingProviderPort;
  supervisor?: ProviderRuntimeSessionStarter;
}>;

export class ProviderRuntimeCommandReceiver implements ProviderCommandTransport {
  readonly #app: Pick<ProviderRuntimeApp, "runOnce">;
  readonly #provider: MessagingProviderPort;
  readonly #supervisor: ProviderRuntimeSessionStarter | undefined;

  constructor(options: ProviderRuntimeCommandReceiverOptions) {
    this.#app = options.app;
    this.#provider = options.provider;
    this.#supervisor = options.supervisor;
  }

  async execute(
    command: ProviderCommand,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    switch (command.kind) {
      case "request_connection":
        return this.requestConnection(command, context);
      case "request_qr_pairing":
        return this.requestQrPairing(command, context);
      case "disconnect":
        return this.disconnect(command, context);
      case "send_outbound_message":
        return this.sendOutboundMessage(command, context);
      case "get_capability_summary":
        return this.getCapabilitySummary(command, context);
    }
  }

  private async requestConnection(
    command: Extract<ProviderCommand, { kind: "request_connection" }>,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    if (command.request.intent !== "connect" && command.request.intent !== "reconnect") {
      return err(
        createApplicationPortFailure({
          category: "rejected",
          code: "provider_command_connection_intent_invalid",
          message: "Provider command bridge received an invalid connection intent.",
          retryable: false,
        }),
      );
    }

    if (
      command.request.intent === "connect" &&
      this.#supervisor !== undefined &&
      command.request.sessionId !== undefined
    ) {
      const started = await this.#supervisor.startSession(
        {
          instanceId: command.request.instanceId,
          providerId: command.request.providerId,
          sessionId: command.request.sessionId,
          reasonCode: command.request.reasonCode,
        },
        context,
      );

      if (started.ok) {
        return ok({
          kind: "request_connection",
          result: connectionResultFromSupervisorSnapshot(command.request, started.value),
        });
      }

      if (started.error.code !== "provider_runtime_supervisor_session_already_active") {
        return err(started.error);
      }
      // The supervisor already owns this session; fall through to the provider
      // connection path so repeated connect commands stay idempotent.
    }

    const runtimeCommand: ProviderRuntimeAppCommand =
      command.request.intent === "reconnect"
        ? {
            action: "reconnect",
            input: {
              instanceId: command.request.instanceId,
              providerId: command.request.providerId,
              reasonCode: command.request.reasonCode,
              ...optional("sessionId", command.request.sessionId),
            },
          }
        : {
            action: "connect",
            input: {
              instanceId: command.request.instanceId,
              providerId: command.request.providerId,
              reasonCode: command.request.reasonCode,
              ...optional("sessionId", command.request.sessionId),
            },
          };
    const result = await this.#app.runOnce(runtimeCommand, context);

    if (!result.result.ok) {
      return runtimeFailure(result.result.failure, result.result.state);
    }

    const connection = connectionResultFromRuntime(result.result.value);

    if (!connection.ok) {
      return connection;
    }

    return ok({
      kind: "request_connection",
      result: connection.value,
    });
  }

  private async requestQrPairing(
    command: Extract<ProviderCommand, { kind: "request_qr_pairing" }>,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    const result = await this.#app.runOnce(
      {
        action: "request_qr_pairing",
        input: {
          instanceId: command.request.instanceId,
          pairingAttemptRef: command.request.pairingAttemptRef,
          providerId: command.request.providerId,
          sessionId: command.request.sessionId,
        },
      },
      context,
    );

    if (!result.result.ok) {
      return runtimeFailure(result.result.failure, result.result.state);
    }

    const challenge = qrPairingChallengeFromRuntime(result.result.value);

    if (!challenge.ok) {
      return challenge;
    }

    return ok({
      kind: "request_qr_pairing",
      result: challenge.value,
    });
  }

  private async disconnect(
    command: Extract<ProviderCommand, { kind: "disconnect" }>,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    if (this.#supervisor?.stopSession !== undefined && command.request.sessionId !== undefined) {
      const stopped = await this.#supervisor.stopSession(
        {
          instanceId: command.request.instanceId,
          providerId: command.request.providerId,
          reasonCode: command.request.reasonCode,
          sessionId: command.request.sessionId,
        },
        context,
      );

      if (stopped.ok) {
        return ok({
          kind: "disconnect",
          result: connectionResultFromSupervisorSnapshot(command.request, stopped.value),
        });
      }

      if (stopped.error.code !== "provider_runtime_supervisor_session_missing") {
        return err(stopped.error);
      }
      // The long-lived supervisor does not own this session, so retain the
      // legacy runtime path for idempotent disconnect behavior.
    }

    const result = await this.#app.runOnce(
      {
        action: "disconnect",
        input: {
          instanceId: command.request.instanceId,
          providerId: command.request.providerId,
          reasonCode: command.request.reasonCode,
          ...optional("sessionId", command.request.sessionId),
        },
      },
      context,
    );

    if (!result.result.ok) {
      return runtimeFailure(result.result.failure, result.result.state);
    }

    const connection = connectionResultFromRuntime(result.result.value);

    if (!connection.ok) {
      return connection;
    }

    return ok({
      kind: "disconnect",
      result: connection.value,
    });
  }

  private async sendOutboundMessage(
    command: Extract<ProviderCommand, { kind: "send_outbound_message" }>,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    const result = await this.#provider.sendOutboundMessage(command.request, context);

    if (!result.ok) {
      return result;
    }

    return ok({
      kind: "send_outbound_message",
      result: result.value,
    });
  }

  private async getCapabilitySummary(
    command: Extract<ProviderCommand, { kind: "get_capability_summary" }>,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    const result = await this.#provider.getCapabilitySummary(command.providerId, context);

    if (!result.ok) {
      return result;
    }

    return ok({
      kind: "get_capability_summary",
      result: result.value,
    });
  }
}

function runtimeFailure(
  failure: ProviderRuntimeFailure,
  state: ProviderRuntimeLifecycleState,
): ApplicationPortResult<never> {
  return err(
    createApplicationPortFailure({
      category: failure.providerPortCategory ?? applicationPortCategoryForRuntimeFailure(failure),
      code: failure.code,
      message: "Provider runtime command failed.",
      retryable: failure.retryable,
      safeMetadata: Object.freeze({
        runtimeSource: failure.source,
        runtimeState: state,
      }),
      ...optional("failureCategory", failure.failureCategory),
    }),
  );
}

function connectionResultFromRuntime(
  value: ProviderConnectionResult | ProviderQrPairingChallenge,
): ApplicationPortResult<ProviderConnectionResult> {
  if ("state" in value && "providerId" in value) {
    return ok(value);
  }

  return invalidRuntimeOutcome("provider_runtime_connection_result_invalid");
}

function qrPairingChallengeFromRuntime(
  value: ProviderConnectionResult | ProviderQrPairingChallenge,
): ApplicationPortResult<ProviderQrPairingChallenge> {
  if ("challengeRef" in value && value.dataClassification === "secret") {
    return ok(value);
  }

  return invalidRuntimeOutcome("provider_runtime_qr_challenge_invalid");
}

function invalidRuntimeOutcome<T>(code: string): ApplicationPortResult<T> {
  return err(
    createApplicationPortFailure({
      category: "unknown",
      code,
      message: "Provider runtime returned an unexpected command outcome.",
      retryable: false,
    }),
  );
}

function applicationPortCategoryForRuntimeFailure(
  failure: ProviderRuntimeFailure,
): ApplicationPortFailureCategory {
  if (failure.retryable) {
    return "unavailable";
  }

  if (failure.source === "secret") {
    return "rejected";
  }

  return "unknown";
}

function connectionResultFromSupervisorSnapshot(
  request: Readonly<{
    instanceId: ProviderConnectionResult["instanceId"];
    providerId: ProviderConnectionResult["providerId"];
  }>,
  snapshot: ProviderRuntimeSupervisorSessionSnapshot,
): ProviderConnectionResult {
  return Object.freeze({
    instanceId: request.instanceId,
    providerId: request.providerId,
    state: connectionStateFromSupervisorState(snapshot.state),
    ...optional("providerSignalRef", snapshot.lastSignalRef),
  });
}

function connectionStateFromSupervisorState(
  state: ProviderRuntimeSupervisorState,
): ProviderConnectionState {
  switch (state) {
    case "CONNECTED":
      return "connected";
    case "QR_REQUIRED":
    case "PAIRING":
      return "qr_required";
    case "DISCONNECTED":
    case "DESTROYED":
      return "disconnected";
    case "LOGGED_OUT":
      return "logged_out";
    case "CREATED":
    case "STARTING":
    case "RECONNECTING":
      return "connecting";
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

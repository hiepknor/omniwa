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
import type { ProviderId } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

export const providerCommandKinds = [
  "request_connection",
  "request_qr_pairing",
  "disconnect",
  "send_outbound_message",
  "get_capability_summary",
] as const;

export type ProviderCommandKind = (typeof providerCommandKinds)[number];

export type ProviderCommand =
  | Readonly<{
      kind: "request_connection";
      commandId: string;
      request: ProviderConnectionRequest;
    }>
  | Readonly<{
      kind: "request_qr_pairing";
      commandId: string;
      request: ProviderQrPairingRequest;
    }>
  | Readonly<{
      kind: "disconnect";
      commandId: string;
      request: ProviderConnectionRequest;
    }>
  | Readonly<{
      kind: "send_outbound_message";
      commandId: string;
      request: ProviderOutboundMessageRequest;
    }>
  | Readonly<{
      kind: "get_capability_summary";
      commandId: string;
      providerId: ProviderId;
    }>;

export type ProviderCommandOutcome =
  | Readonly<{
      kind: "request_connection";
      result: ProviderConnectionResult;
    }>
  | Readonly<{
      kind: "request_qr_pairing";
      result: ProviderQrPairingChallenge;
    }>
  | Readonly<{
      kind: "disconnect";
      result: ProviderConnectionResult;
    }>
  | Readonly<{
      kind: "send_outbound_message";
      result: ProviderOutboundMessageResult;
    }>
  | Readonly<{
      kind: "get_capability_summary";
      result: ProviderCapabilitySummary;
    }>;

export type ProviderCommandTransport = Readonly<{
  execute(
    command: ProviderCommand,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>>;
}>;

export type ProviderCommandTransportHandler = (
  command: ProviderCommand,
  context: ApplicationPortContext,
) =>
  | Promise<ApplicationPortResult<ProviderCommandOutcome>>
  | ApplicationPortResult<ProviderCommandOutcome>;

export type InMemoryProviderCommandTransportOptions = Readonly<{
  handler?: ProviderCommandTransportHandler;
}>;

export class InMemoryProviderCommandTransport implements ProviderCommandTransport {
  private readonly handler: ProviderCommandTransportHandler | undefined;
  private readonly recordedCommands: ProviderCommand[] = [];

  constructor(options: InMemoryProviderCommandTransportOptions = {}) {
    this.handler = options.handler;
  }

  async execute(
    command: ProviderCommand,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    this.recordedCommands.push(command);

    if (this.handler === undefined) {
      return err(
        createProviderCommandTransportFailure({
          code: "provider_command_transport_unconfigured",
          message: "Provider command bridge is not configured.",
          retryable: true,
        }),
      );
    }

    return this.handler(command, context);
  }

  commands(): readonly ProviderCommand[] {
    return Object.freeze([...this.recordedCommands]);
  }

  clear(): void {
    this.recordedCommands.length = 0;
  }
}

export type ProviderCommandMessagingProviderAdapterOptions = Readonly<{
  transport: ProviderCommandTransport;
}>;

export class ProviderCommandMessagingProviderAdapter implements MessagingProviderPort {
  private readonly transport: ProviderCommandTransport;

  constructor(options: ProviderCommandMessagingProviderAdapterOptions) {
    this.transport = options.transport;
  }

  async requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    const result = await this.transport.execute(
      Object.freeze({
        kind: "request_connection",
        commandId: commandIdFor("request_connection", context, [
          request.instanceId,
          request.providerId,
          request.intent,
          request.reasonCode,
        ]),
        request,
      }),
      context,
    );

    if (!result.ok) {
      return result;
    }

    if (result.value.kind !== "request_connection") {
      return invalidOutcome("request_connection", result.value.kind);
    }

    return ok(result.value.result);
  }

  async requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> {
    const result = await this.transport.execute(
      Object.freeze({
        kind: "request_qr_pairing",
        commandId: commandIdFor("request_qr_pairing", context, [
          request.instanceId,
          request.providerId,
          request.sessionId,
          request.pairingAttemptRef,
        ]),
        request,
      }),
      context,
    );

    if (!result.ok) {
      return result;
    }

    if (result.value.kind !== "request_qr_pairing") {
      return invalidOutcome("request_qr_pairing", result.value.kind);
    }

    return ok(result.value.result);
  }

  async disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    const result = await this.transport.execute(
      Object.freeze({
        kind: "disconnect",
        commandId: commandIdFor("disconnect", context, [
          request.instanceId,
          request.providerId,
          request.intent,
          request.reasonCode,
        ]),
        request,
      }),
      context,
    );

    if (!result.ok) {
      return result;
    }

    if (result.value.kind !== "disconnect") {
      return invalidOutcome("disconnect", result.value.kind);
    }

    return ok(result.value.result);
  }

  async sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> {
    const result = await this.transport.execute(
      Object.freeze({
        kind: "send_outbound_message",
        commandId: commandIdFor("send_outbound_message", context, [
          request.instanceId,
          request.providerId,
          request.sessionId,
          request.messageId,
          request.outboundIntentRef,
        ]),
        request,
      }),
      context,
    );

    if (!result.ok) {
      return result;
    }

    if (result.value.kind !== "send_outbound_message") {
      return invalidOutcome("send_outbound_message", result.value.kind);
    }

    return ok(result.value.result);
  }

  async getCapabilitySummary(
    providerId: ProviderId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    const result = await this.transport.execute(
      Object.freeze({
        kind: "get_capability_summary",
        commandId: commandIdFor("get_capability_summary", context, [providerId]),
        providerId,
      }),
      context,
    );

    if (!result.ok) {
      return result;
    }

    if (result.value.kind !== "get_capability_summary") {
      return invalidOutcome("get_capability_summary", result.value.kind);
    }

    return ok(result.value.result);
  }
}

export function createProviderCommandTransportFailure(input: {
  code: string;
  message: string;
  retryable: boolean;
}) {
  return createApplicationPortFailure({
    category: "unavailable",
    code: input.code,
    message: input.message,
    retryable: input.retryable,
  });
}

function invalidOutcome<T>(
  expectedKind: ProviderCommandKind,
  actualKind: ProviderCommandKind,
): ApplicationPortResult<T> {
  return err(
    createApplicationPortFailure({
      category: "unknown",
      code: "provider_command_transport_invalid_outcome",
      message: "Provider command bridge returned an unexpected outcome.",
      retryable: false,
      safeMetadata: Object.freeze({
        actualKind,
        expectedKind,
      }),
    }),
  );
}

function commandIdFor(
  kind: ProviderCommandKind,
  context: ApplicationPortContext,
  parts: readonly string[],
): string {
  const idempotencyKey = context.idempotencyKey?.trim();

  if (idempotencyKey !== undefined && idempotencyKey.length > 0) {
    return `${kind}:${idempotencyKey}`;
  }

  return `${kind}:${parts.join(":")}`;
}

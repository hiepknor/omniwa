import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type MessagingProviderPort,
  type ProviderCapabilitySummary,
  type ProviderConnectionRequest,
  type ProviderConnectionResult,
  type ProviderConnectionState,
  type ProviderOutboundMessageRequest,
  type ProviderOutboundMessageResult,
  type ProviderQrPairingChallenge,
  type ProviderQrPairingRequest,
  type ProviderSendStatus,
  type TranslatedProviderSignal,
} from "@omniwa/application";
import {
  createFailureCategory,
  createMessageType,
  type FailureCategory,
  type MessageType,
  type ProviderId,
} from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";
import type {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessage,
  WASocket,
} from "@whiskeysockets/baileys";

export const baileysProviderKind = "baileys";

const defaultSupportedMessageTypes = Object.freeze([
  createMessageType("text"),
  createMessageType("image"),
  createMessageType("video"),
  createMessageType("document"),
  createMessageType("audio"),
]);

export type BaileysSocketLike = Pick<
  WASocket,
  "sendMessage" | "logout" | "requestPairingCode"
> &
  Readonly<{
    user?: Readonly<{ id?: string }>;
  }>;

export type BaileysSocketRequest = Readonly<{
  instanceId: ProviderConnectionRequest["instanceId"];
  providerId: ProviderId;
  sessionId?: ProviderConnectionRequest["sessionId"];
  reasonCode: string;
}>;

export type BaileysSocketProvider = Readonly<{
  getSocket(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<BaileysSocketLike> | BaileysSocketLike;
}>;

export type BaileysResolvedOutboundMessage = Readonly<{
  jid: string;
  content: AnyMessageContent;
  options?: MiscMessageGenerationOptions;
}>;

export type BaileysOutboundMessageResolver = Readonly<{
  resolveOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<BaileysResolvedOutboundMessage> | BaileysResolvedOutboundMessage;
}>;

export type BaileysQrChallenge = Readonly<{
  challengeRef: string;
  expiresAtEpochMilliseconds?: number;
}>;

export type BaileysQrChallengeResolver = Readonly<{
  resolveQrChallenge(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<BaileysQrChallenge> | BaileysQrChallenge;
}>;

export type BaileysProviderGateway = Readonly<{
  requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderConnectionResult>;
  requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderQrPairingChallenge>;
  disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderConnectionResult>;
  sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderOutboundMessageResult>;
  getCapabilitySummary(
    providerId: ProviderId,
    context: ApplicationPortContext,
  ): Promise<ProviderCapabilitySummary>;
}>;

export type BaileysSocketGatewayOptions = Readonly<{
  socketProvider: BaileysSocketProvider;
  outboundMessageResolver: BaileysOutboundMessageResolver;
  qrChallengeResolver?: BaileysQrChallengeResolver;
  supportedMessageTypes?: readonly string[];
}>;

export class BaileysProviderError extends Error {
  readonly code: string;
  readonly category: ApplicationPortFailureCategory;
  readonly failureCategory: FailureCategory;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    category: ApplicationPortFailureCategory;
    failureCategory: FailureCategory;
    retryable: boolean;
    message?: string;
  }) {
    super(input.message ?? "Baileys provider operation failed.");
    this.name = "BaileysProviderError";
    this.code = input.code;
    this.category = input.category;
    this.failureCategory = input.failureCategory;
    this.retryable = input.retryable;
  }
}

export class BaileysSocketGateway implements BaileysProviderGateway {
  private readonly socketProvider: BaileysSocketProvider;
  private readonly outboundMessageResolver: BaileysOutboundMessageResolver;
  private readonly qrChallengeResolver: BaileysQrChallengeResolver | undefined;
  private readonly supportedMessageTypes: readonly MessageType[];

  constructor(options: BaileysSocketGatewayOptions) {
    this.socketProvider = options.socketProvider;
    this.outboundMessageResolver = options.outboundMessageResolver;
    this.qrChallengeResolver = options.qrChallengeResolver;
    this.supportedMessageTypes = normalizeSupportedMessageTypes(options.supportedMessageTypes);
  }

  async requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderConnectionResult> {
    const socket = await this.socketProvider.getSocket(socketRequestFromConnection(request), context);
    const state: ProviderConnectionState = socket.user?.id === undefined ? "connecting" : "connected";

    return freezeConnectionResult({
      instanceId: request.instanceId,
      providerId: request.providerId,
      state,
      providerSignalRef: providerSignalRef(request.providerId, state),
    });
  }

  async requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderQrPairingChallenge> {
    const challenge =
      this.qrChallengeResolver === undefined
        ? { challengeRef: request.pairingAttemptRef }
        : await this.qrChallengeResolver.resolveQrChallenge(request, context);

    if (challenge.challengeRef.trim().length === 0) {
      throw new BaileysProviderError({
        code: "baileys_qr_challenge_missing",
        category: "rejected",
        failureCategory: createFailureCategory("provider"),
        retryable: false,
      });
    }

    return freezeQrChallenge(
      challenge.expiresAtEpochMilliseconds === undefined
        ? {
            instanceId: request.instanceId,
            sessionId: request.sessionId,
            challengeRef: challenge.challengeRef,
            dataClassification: "secret",
          }
        : {
            instanceId: request.instanceId,
            sessionId: request.sessionId,
            challengeRef: challenge.challengeRef,
            expiresAtEpochMilliseconds: challenge.expiresAtEpochMilliseconds,
            dataClassification: "secret",
          },
    );
  }

  async disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderConnectionResult> {
    const socket = await this.socketProvider.getSocket(socketRequestFromConnection(request), context);
    await socket.logout();

    return freezeConnectionResult({
      instanceId: request.instanceId,
      providerId: request.providerId,
      state: "disconnected",
      providerSignalRef: providerSignalRef(request.providerId, "disconnected"),
    });
  }

  async sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ProviderOutboundMessageResult> {
    const socket = await this.socketProvider.getSocket(
      {
        instanceId: request.instanceId,
        providerId: request.providerId,
        sessionId: request.sessionId,
        reasonCode: "send_outbound_message",
      },
      context,
    );
    const resolved = await this.outboundMessageResolver.resolveOutboundMessage(request, context);
    const sent = await socket.sendMessage(resolved.jid, resolved.content, resolved.options);
    const status: ProviderSendStatus = sent === undefined ? "unknown" : "accepted";

    return freezeOutboundResult({
      messageId: request.messageId,
      status,
      retryable: status === "unknown",
      ...optionalString("providerReceiptRef", sent?.key.id ?? undefined),
      ...(status === "unknown"
        ? {
            failureCategory: createFailureCategory("provider"),
          }
        : {}),
    });
  }

  async getCapabilitySummary(
    providerId: ProviderId,
    context: ApplicationPortContext,
  ): Promise<ProviderCapabilitySummary> {
    void context;

    return freezeCapabilitySummary({
      providerId,
      supportedMessageTypes: this.supportedMessageTypes,
      degraded: false,
    });
  }
}

export type BaileysMessagingProviderAdapterOptions = Readonly<{
  gateway: BaileysProviderGateway;
}>;

export class BaileysMessagingProviderAdapter implements MessagingProviderPort {
  private readonly gateway: BaileysProviderGateway;

  constructor(options: BaileysMessagingProviderAdapterOptions) {
    this.gateway = options.gateway;
  }

  async requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    return this.invoke("request_connection", () => this.gateway.requestConnection(request, context));
  }

  async requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> {
    return this.invoke("request_qr_pairing", () => this.gateway.requestQrPairing(request, context));
  }

  async disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    return this.invoke("disconnect", () => this.gateway.disconnect(request, context));
  }

  async sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> {
    return this.invoke("send_outbound_message", () =>
      this.gateway.sendOutboundMessage(request, context),
    );
  }

  async getCapabilitySummary(
    providerId: ProviderId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    return this.invoke("get_capability_summary", () =>
      this.gateway.getCapabilitySummary(providerId, context),
    );
  }

  private async invoke<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<ApplicationPortResult<T>> {
    try {
      return ok(await action());
    } catch (error) {
      return err(baileysErrorToPortFailure(error, operation));
    }
  }
}

export type BaileysSignalInput = Readonly<{
  signalRef: string;
  providerId: ProviderId;
  targetRef: string;
  occurrenceRef: string;
  kind: TranslatedProviderSignal["kind"];
  dataClassification?: TranslatedProviderSignal["dataClassification"];
  failureCategory?: FailureCategory;
}>;

export function createTranslatedBaileysSignal(input: BaileysSignalInput): TranslatedProviderSignal {
  return freezeTranslatedSignal({
    signalRef: input.signalRef,
    providerId: input.providerId,
    targetRef: input.targetRef,
    occurrenceRef: input.occurrenceRef,
    kind: input.kind,
    dataClassification: input.dataClassification ?? "internal",
    ...optionalValue("failureCategory", input.failureCategory),
  });
}

function baileysErrorToPortFailure(error: unknown, operation: string): ApplicationPortFailure {
  if (error instanceof BaileysProviderError) {
    return createApplicationPortFailure({
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ownerContext: "provider_integration",
      failureCategory: error.failureCategory,
      safeMetadata: {
        operation,
      },
    });
  }

  const statusCode = extractProviderStatusCode(error);
  const category = categoryFromStatusCode(statusCode);
  const retryable = statusCode === undefined ? true : isRetryableStatusCode(statusCode);

  return createApplicationPortFailure({
    category,
    code: "baileys_provider_failure",
    message: "Baileys provider operation failed with a sanitized provider error.",
    retryable,
    ownerContext: "provider_integration",
    failureCategory: failureCategoryFromPortCategory(category),
    safeMetadata:
      statusCode === undefined
        ? { operation }
        : {
            operation,
            providerStatusCode: statusCode,
          },
  });
}

function extractProviderStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const output = "output" in error ? error.output : undefined;
  if (typeof output !== "object" || output === null || !("statusCode" in output)) {
    return undefined;
  }

  return typeof output.statusCode === "number" ? output.statusCode : undefined;
}

function categoryFromStatusCode(
  statusCode: number | undefined,
): ApplicationPortFailureCategory {
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode === 409) return "conflict";
  if (statusCode === 401 || statusCode === 403 || statusCode === 410) return "rejected";
  if (statusCode !== undefined && statusCode >= 500) return "unavailable";
  return "unknown";
}

function failureCategoryFromPortCategory(
  category: ApplicationPortFailureCategory,
): FailureCategory {
  if (category === "timeout" || category === "unavailable") {
    return createFailureCategory("network");
  }

  if (category === "rejected" || category === "unsupported") {
    return createFailureCategory("provider");
  }

  return createFailureCategory("unexpected");
}

function isRetryableStatusCode(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function normalizeSupportedMessageTypes(
  values: readonly string[] | undefined,
): readonly MessageType[] {
  if (values === undefined) {
    return defaultSupportedMessageTypes;
  }

  return Object.freeze(
    values.flatMap((value) => {
      try {
        return [createMessageType(value)];
      } catch {
        return [];
      }
    }),
  );
}

function socketRequestFromConnection(request: ProviderConnectionRequest): BaileysSocketRequest {
  return Object.freeze({
    instanceId: request.instanceId,
    providerId: request.providerId,
    ...optionalValue("sessionId", request.sessionId),
    reasonCode: request.reasonCode,
  });
}

function providerSignalRef(providerId: ProviderId, state: ProviderConnectionState): string {
  return `${String(providerId)}.${state}`;
}

function optionalString<TKey extends string>(
  key: TKey,
  value: string | undefined,
): Partial<Record<TKey, string>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, string>>);
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function freezeConnectionResult(result: ProviderConnectionResult): ProviderConnectionResult {
  return Object.freeze(result);
}

function freezeQrChallenge(challenge: ProviderQrPairingChallenge): ProviderQrPairingChallenge {
  return Object.freeze(challenge);
}

function freezeOutboundResult(
  result: ProviderOutboundMessageResult,
): ProviderOutboundMessageResult {
  return Object.freeze(result);
}

function freezeCapabilitySummary(summary: ProviderCapabilitySummary): ProviderCapabilitySummary {
  return Object.freeze({
    ...summary,
    supportedMessageTypes: Object.freeze([...summary.supportedMessageTypes]),
  });
}

function freezeTranslatedSignal(signal: TranslatedProviderSignal): TranslatedProviderSignal {
  return Object.freeze(signal);
}

export type BaileysSentMessage = WAMessage;

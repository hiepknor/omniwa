import type { ApplicationPortContext, TranslatedProviderSignal } from "@omniwa/application";
import {
  createFailureCategory,
  type FailureCategory,
  type InstanceId,
  type ProviderId,
  type SessionId,
} from "@omniwa/domain";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { BaileysProviderError } from "./baileys-messaging-provider.adapter.js";

export type BaileysSocketLike = Pick<WASocket, "sendMessage" | "logout" | "requestPairingCode"> &
  Readonly<{
    user?: Readonly<{ id?: string }>;
  }>;

export type BaileysSocketRequest = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId?: SessionId;
  reasonCode: string;
}>;

export type BaileysSocketProvider = Readonly<{
  getSocket(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<BaileysSocketLike> | BaileysSocketLike;
  startSession(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<readonly TranslatedProviderSignal[]> | readonly TranslatedProviderSignal[];
  closeSession(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<readonly TranslatedProviderSignal[]> | readonly TranslatedProviderSignal[];
  drainSignals(request?: BaileysSocketSignalQuery): readonly TranslatedProviderSignal[];
}>;

export type BaileysSocketSignalQuery = Readonly<{
  instanceId?: InstanceId;
  sessionId?: SessionId;
}>;

export type FakeBaileysSocketOptions = Readonly<{
  userId?: string;
  receiptId?: string;
  sendError?: unknown;
}>;

export type FakeBaileysSentMessage = Readonly<{
  jid: string;
  content: Parameters<BaileysSocketLike["sendMessage"]>[1];
  options: Parameters<BaileysSocketLike["sendMessage"]>[2] | undefined;
}>;

export class FakeBaileysSocket implements BaileysSocketLike {
  readonly sentMessages: FakeBaileysSentMessage[] = [];
  readonly user?: Readonly<{ id?: string }>;
  logoutCalled = false;
  private readonly receiptId: string;
  private readonly sendError: unknown;

  constructor(options: FakeBaileysSocketOptions = {}) {
    this.user =
      options.userId === undefined ? { id: "connected-provider-user" } : { id: options.userId };
    this.receiptId = options.receiptId ?? "baileys-receipt-1";
    this.sendError = options.sendError;
  }

  sendMessage: BaileysSocketLike["sendMessage"] = async (jid, content, options) => {
    if (this.sendError !== undefined) {
      throw this.sendError;
    }

    this.sentMessages.push({ jid, content, options });

    return {
      key: {
        id: this.receiptId,
      },
    } as WAMessage;
  };

  logout: BaileysSocketLike["logout"] = async () => {
    this.logoutCalled = true;
  };

  requestPairingCode: BaileysSocketLike["requestPairingCode"] = async () => "pairing-code";
}

export class FakeBaileysSocketProvider implements BaileysSocketProvider {
  private readonly sockets = new Map<string, BaileysSocketLike>();
  private readonly signals: TranslatedProviderSignal[] = [];
  private occurrenceSequence = 0;
  private nextGetSocketError: unknown;

  registerSocket(request: BaileysSocketRequest, socket: BaileysSocketLike): void {
    this.sockets.set(socketKey(request), socket);
  }

  failNextGetSocket(error: unknown): void {
    this.nextGetSocketError = error;
  }

  getSocket(request: BaileysSocketRequest, context: ApplicationPortContext): BaileysSocketLike {
    void context;

    if (this.nextGetSocketError !== undefined) {
      const error = this.nextGetSocketError;
      this.nextGetSocketError = undefined;
      throw mapBaileysSocketProviderError(error);
    }

    const socket = this.sockets.get(socketKey(request));

    if (socket === undefined) {
      throw new BaileysProviderError({
        code: "baileys_socket_missing",
        category: "rejected",
        failureCategory: createFailureCategory("provider"),
        retryable: false,
        message: "Baileys socket is not available for the requested session.",
      });
    }

    return socket;
  }

  startSession(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): readonly TranslatedProviderSignal[] {
    void context;

    if (!this.sockets.has(socketKey(request))) {
      this.registerSocket(request, new FakeBaileysSocket());
    }

    return [this.recordSignal(request, "connection", "connecting", "internal")];
  }

  async closeSession(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<readonly TranslatedProviderSignal[]> {
    const socket = this.getSocket(request, context);
    await socket.logout();
    this.sockets.delete(socketKey(request));

    return [this.recordSignal(request, "connection", "disconnected", "internal")];
  }

  emitQrRequired(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
    rawProviderPayload?: unknown,
  ): TranslatedProviderSignal {
    void context;
    void rawProviderPayload;

    return this.recordSignal(request, "auth", "qr_required", "confidential");
  }

  emitConnected(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): TranslatedProviderSignal {
    void context;

    return this.recordSignal(request, "connection", "connected", "internal");
  }

  emitDisconnected(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): TranslatedProviderSignal {
    void context;

    return this.recordSignal(request, "connection", "disconnected", "internal");
  }

  drainSignals(request?: BaileysSocketSignalQuery): readonly TranslatedProviderSignal[] {
    const drained =
      request === undefined
        ? [...this.signals]
        : this.signals.filter((signal) => signalMatchesQuery(signal, request));

    if (request === undefined) {
      this.signals.length = 0;
      return Object.freeze(drained);
    }

    const remaining = this.signals.filter((signal) => !signalMatchesQuery(signal, request));
    this.signals.length = 0;
    this.signals.push(...remaining);

    return Object.freeze(drained);
  }

  private recordSignal(
    request: BaileysSocketRequest,
    kind: TranslatedProviderSignal["kind"],
    signalCode: string,
    dataClassification: TranslatedProviderSignal["dataClassification"],
    failureCategory?: FailureCategory,
  ): TranslatedProviderSignal {
    this.occurrenceSequence += 1;

    const targetRef = request.sessionId ?? request.instanceId;
    const signal = Object.freeze({
      signalRef: `${String(request.providerId)}.${signalCode}`,
      providerId: request.providerId,
      targetRef,
      occurrenceRef: `${String(request.providerId)}.${targetRef}.${this.occurrenceSequence}`,
      kind,
      dataClassification,
      ...(failureCategory === undefined ? {} : { failureCategory }),
    });

    this.signals.push(signal);

    return signal;
  }
}

export function mapBaileysSocketProviderError(error: unknown): BaileysProviderError {
  if (error instanceof BaileysProviderError) {
    return error;
  }

  const statusCode = extractProviderStatusCode(error);
  const category = socketProviderCategoryFromStatusCode(statusCode);

  return new BaileysProviderError({
    code: "baileys_socket_provider_failure",
    category,
    failureCategory: socketFailureCategoryFromStatusCode(statusCode),
    retryable: socketProviderRetryableFromStatusCode(statusCode),
    message: "Baileys socket provider failed with a sanitized provider error.",
  });
}

function socketKey(request: BaileysSocketRequest): string {
  return `${String(request.instanceId)}::${request.sessionId ?? "default"}`;
}

function signalMatchesQuery(
  signal: TranslatedProviderSignal,
  query: BaileysSocketSignalQuery,
): boolean {
  if (query.sessionId !== undefined && signal.targetRef !== query.sessionId) {
    return false;
  }

  if (query.instanceId !== undefined && signal.targetRef !== query.instanceId) {
    return false;
  }

  return true;
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

function socketProviderCategoryFromStatusCode(
  statusCode: number | undefined,
): BaileysProviderError["category"] {
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode === 409) return "conflict";
  if (statusCode === 401 || statusCode === 403 || statusCode === 410) return "rejected";
  if (statusCode !== undefined && statusCode >= 500) return "unavailable";
  return "unknown";
}

function socketProviderRetryableFromStatusCode(statusCode: number | undefined): boolean {
  return statusCode === undefined || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function socketFailureCategoryFromStatusCode(statusCode: number | undefined): FailureCategory {
  if (
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode === 504 ||
    (statusCode !== undefined && statusCode >= 500)
  ) {
    return createFailureCategory("network");
  }

  if (statusCode === 401 || statusCode === 403 || statusCode === 410) {
    return createFailureCategory("provider");
  }

  return createFailureCategory("unexpected");
}

import { createHash } from "node:crypto";

import type { ApplicationPortContext, TranslatedProviderSignal } from "@omniwa/application";
import {
  createFailureCategory,
  type FailureCategory,
  type InstanceId,
  type ProviderId,
  type SessionId,
} from "@omniwa/domain";
import {
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  WAMessageStatus,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeWASocket,
  type AuthenticationCreds,
  type AuthenticationState,
  type BaileysEventMap,
  type MessageUserReceiptUpdate,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type UserFacingSocketConfig,
  type WAMessage,
  type WAMessageUpdate,
  type WASocket,
} from "@whiskeysockets/baileys";

import type {
  BaileysAuthStateJsonValue,
  BaileysAuthStateSnapshot,
  BaileysAuthStateStore,
} from "./baileys-auth-state-store.js";
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

export type BaileysSocketFactory = (config: UserFacingSocketConfig) => WASocket;

export type RealBaileysSocketProviderOptions = Readonly<{
  authStateStore: BaileysAuthStateStore;
  socketFactory?: BaileysSocketFactory;
  nowEpochMilliseconds?: () => number;
  qrChallengeTtlMs?: number;
  qrCodeOperatorSink?: BaileysQrCodeOperatorSink;
  inboundRecipientOperatorSink?: BaileysInboundRecipientOperatorSink;
}>;

export type BaileysQrCodeOperatorEvent = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId?: SessionId;
  challengeRef: string;
  expiresAtEpochMilliseconds: number;
  qrCode: string;
  dataClassification: "secret";
  localOnly: true;
}>;

export type BaileysQrCodeOperatorSink = Readonly<{
  captureQrCode(event: BaileysQrCodeOperatorEvent): void;
}>;

export type BaileysInboundRecipientOperatorEvent = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId?: SessionId;
  conversationRef: string;
  conversationKind: "private" | "group" | "unknown";
  recipientJid: string;
  occurredAt: string;
  dataClassification: "secret";
  localOnly: true;
}>;

export type BaileysInboundRecipientOperatorSink = Readonly<{
  captureInboundRecipient(event: BaileysInboundRecipientOperatorEvent): void;
}>;

export const baileysDisconnectActions = [
  "reconnect",
  "clear_auth_and_logged_out",
  "surrender_ownership",
  "stop_no_retry",
  "unknown_retryable",
] as const;

export type BaileysDisconnectAction = (typeof baileysDisconnectActions)[number];

export type BaileysDisconnectDecision = Readonly<{
  action: BaileysDisconnectAction;
  signalCode: string;
  retryable: boolean;
  clearAuthState: boolean;
  surrenderOwnership: boolean;
  backoffMs?: number;
  statusCode?: number;
  failureCategory: FailureCategory;
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

    return socket as BaileysSocketLike;
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

export class RealBaileysSocketProvider implements BaileysSocketProvider {
  private readonly authStateStore: BaileysAuthStateStore;
  private readonly socketFactory: BaileysSocketFactory;
  private readonly nowEpochMilliseconds: () => number;
  private readonly qrChallengeTtlMs: number;
  private readonly qrCodeOperatorSink: BaileysQrCodeOperatorSink | undefined;
  private readonly inboundRecipientOperatorSink: BaileysInboundRecipientOperatorSink | undefined;
  private readonly sockets = new Map<string, WASocket>();
  private readonly signals: TranslatedProviderSignal[] = [];
  private readonly resolveLatestWaWebVersion: boolean;
  private cachedWaWebVersion: UserFacingSocketConfig["version"];

  constructor(options: RealBaileysSocketProviderOptions) {
    this.authStateStore = options.authStateStore;
    this.socketFactory = options.socketFactory ?? makeWASocket;
    // Only the real socket needs the current WhatsApp Web version; injected
    // factories (tests/fakes) must not trigger network version lookups.
    this.resolveLatestWaWebVersion = options.socketFactory === undefined;
    this.nowEpochMilliseconds = options.nowEpochMilliseconds ?? Date.now;
    this.qrChallengeTtlMs = options.qrChallengeTtlMs ?? 60_000;
    this.qrCodeOperatorSink = options.qrCodeOperatorSink;
    this.inboundRecipientOperatorSink = options.inboundRecipientOperatorSink;
  }

  private async latestWaWebVersion(): Promise<UserFacingSocketConfig["version"]> {
    if (!this.resolveLatestWaWebVersion) {
      return undefined;
    }

    if (this.cachedWaWebVersion !== undefined) {
      return this.cachedWaWebVersion;
    }

    try {
      const { version } = await fetchLatestBaileysVersion();
      this.cachedWaWebVersion = version;
      return version;
    } catch {
      // Fall back to the library default version when the lookup is unavailable.
      return undefined;
    }
  }

  getSocket(request: BaileysSocketRequest, context: ApplicationPortContext): BaileysSocketLike {
    void context;

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

    return socket as BaileysSocketLike;
  }

  async startSession(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<readonly TranslatedProviderSignal[]> {
    void context;

    if (request.sessionId === undefined) {
      throw safeSocketProviderFailure("baileys_session_required", false);
    }

    const loaded = await this.authStateStore.load(request.sessionId);

    if (!loaded.ok) {
      throw safeSocketProviderFailure("baileys_auth_state_load_failed", loaded.error.retryable);
    }

    const auth = createBaileysAuthenticationState({
      sessionId: request.sessionId,
      authStateStore: this.authStateStore,
      snapshot: loaded.value?.state,
    });

    const waWebVersion = await this.latestWaWebVersion();

    try {
      const socket = this.socketFactory({
        ...DEFAULT_CONNECTION_CONFIG,
        auth: auth.state,
        emitOwnEvents: false,
        logger: createSilentBaileysLogger(),
        printQRInTerminal: false,
        ...(waWebVersion === undefined ? {} : { version: waWebVersion }),
      });

      socket.ev.on("creds.update", (update) => {
        Object.assign(auth.state.creds, update);
        void auth.persist();
      });
      socket.ev.on("connection.update", (update) => {
        void this.recordConnectionUpdate(request, update);
      });
      socket.ev.on("messages.upsert", (update) => {
        this.recordMessagesUpsert(request, update);
      });
      socket.ev.on("messages.update", (updates) => {
        this.recordMessagesUpdate(request, updates);
      });
      socket.ev.on("message-receipt.update", (updates) => {
        this.recordMessageReceiptUpdates(request, updates);
      });

      this.sockets.set(socketKey(request), socket);

      return Object.freeze([
        this.recordSignal(request, "connection", "connecting", "internal", "connecting"),
      ]);
    } catch (error) {
      throw mapBaileysSocketProviderError(error);
    }
  }

  async closeSession(
    request: BaileysSocketRequest,
    context: ApplicationPortContext,
  ): Promise<readonly TranslatedProviderSignal[]> {
    const socket = this.getSocket(request, context);

    await socket.logout();
    this.sockets.delete(socketKey(request));

    return Object.freeze([
      this.recordSignal(request, "connection", "disconnected", "internal", "closed"),
    ]);
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

  private async recordConnectionUpdate(
    request: BaileysSocketRequest,
    update: BaileysEventMap["connection.update"],
  ): Promise<void> {
    if (update.qr !== undefined) {
      this.recordQrUpdate(request, update.qr);
    }

    if (update.connection === "open") {
      this.recordSignal(request, "connection", "connected", "internal", "connected");
      return;
    }

    if (update.connection === "close") {
      await this.recordDisconnectUpdate(request, update);
      return;
    }

    if (update.connection === "connecting") {
      this.recordSignal(request, "connection", "connecting", "internal", "connecting");
    }
  }

  private recordQrUpdate(request: BaileysSocketRequest, qr: unknown): void {
    if (typeof qr !== "string" || qr.trim().length === 0) {
      this.recordSignal(
        request,
        "failure",
        "qr_update_invalid",
        "confidential",
        "qr_update_invalid",
        createFailureCategory("provider"),
        {
          reasonCode: "malformed_qr",
        },
      );
      return;
    }

    const challengeRef = createQrChallengeRef(request, qr);
    const expiresAtEpochMilliseconds = this.nowEpochMilliseconds() + this.qrChallengeTtlMs;

    this.recordSignal(
      request,
      "auth",
      "qr_required",
      "confidential",
      `qr_required.${challengeRef}`,
      undefined,
      {
        challengeRef,
        expiresAtEpochMilliseconds,
        refreshPolicy: "replace_active",
      },
    );

    try {
      this.qrCodeOperatorSink?.captureQrCode({
        instanceId: request.instanceId,
        providerId: request.providerId,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        challengeRef,
        expiresAtEpochMilliseconds,
        qrCode: qr,
        dataClassification: "secret",
        localOnly: true,
      });
    } catch {
      this.recordSignal(
        request,
        "failure",
        "qr_operator_sink_failed",
        "confidential",
        `qr_operator_sink_failed.${challengeRef}`,
        createFailureCategory("provider"),
        {
          reasonCode: "qr_operator_sink_failed",
          challengeRef,
        },
      );
    }
  }

  private recordMessagesUpsert(request: BaileysSocketRequest, upsert: unknown): void {
    if (!isMessageUpsertPayload(upsert)) {
      this.recordInboundFailure(request, "malformed_inbound_upsert", "inbound_upsert_malformed");
      return;
    }

    upsert.messages.forEach((message, index) => {
      this.recordInboundMessage(request, message, index);
    });
  }

  private recordMessagesUpdate(request: BaileysSocketRequest, updates: unknown): void {
    if (!Array.isArray(updates)) {
      this.recordStatusFailure(request, "malformed_message_status_update", "status_malformed");
      return;
    }

    updates.forEach((update, index) => {
      this.recordMessageStatusUpdate(request, update, index);
    });
  }

  private recordMessageReceiptUpdates(request: BaileysSocketRequest, updates: unknown): void {
    if (!Array.isArray(updates)) {
      this.recordStatusFailure(request, "malformed_message_receipt_update", "receipt_malformed");
      return;
    }

    updates.forEach((update, index) => {
      this.recordMessageReceiptUpdate(request, update, index);
    });
  }

  private recordMessageStatusUpdate(
    request: BaileysSocketRequest,
    rawUpdate: unknown,
    index: number,
  ): void {
    const update = isObjectRecord(rawUpdate) ? (rawUpdate as Partial<WAMessageUpdate>) : undefined;
    const key = isObjectRecord(update?.key) ? update.key : undefined;
    const providerMessageId = typeof key?.id === "string" ? key.id : undefined;

    if (providerMessageId === undefined) {
      this.recordStatusFailure(
        request,
        "malformed_message_status_update",
        `status_malformed.${index}`,
      );
      return;
    }

    const statusCandidate = readMessageUpdateStatus(update);

    if (statusCandidate === undefined && isMessageContentOnlyUpdate(update?.update)) {
      return;
    }

    const status = mapBaileysMessageStatus(statusCandidate);

    if (status === undefined) {
      const providerMessageRef = createProviderMessageRef(request, providerMessageId);

      this.recordStatusFailure(
        request,
        "unsupported_message_status",
        `status_unsupported.${providerMessageRef}`,
        {
          providerMessageRef,
        },
      );
      return;
    }

    this.recordMessageStatusSignal(
      request,
      providerMessageId,
      status,
      readMessageUpdateTimestamp(update),
    );
  }

  private recordMessageReceiptUpdate(
    request: BaileysSocketRequest,
    rawUpdate: unknown,
    index: number,
  ): void {
    const update = isObjectRecord(rawUpdate)
      ? (rawUpdate as Partial<MessageUserReceiptUpdate>)
      : undefined;
    const key = isObjectRecord(update?.key) ? update.key : undefined;
    const providerMessageId = typeof key?.id === "string" ? key.id : undefined;

    if (providerMessageId === undefined) {
      this.recordStatusFailure(
        request,
        "malformed_message_receipt_update",
        `receipt_malformed.${index}`,
      );
      return;
    }

    const receipt = isObjectRecord(update?.receipt) ? update.receipt : undefined;
    const status = mapBaileysReceiptStatus(receipt);

    if (status === undefined) {
      const providerMessageRef = createProviderMessageRef(request, providerMessageId);

      this.recordStatusFailure(
        request,
        "unsupported_message_receipt_status",
        `receipt_unsupported.${providerMessageRef}`,
        {
          providerMessageRef,
        },
      );
      return;
    }

    this.recordMessageStatusSignal(
      request,
      providerMessageId,
      status,
      readMessageReceiptTimestamp(receipt),
    );
  }

  private recordMessageStatusSignal(
    request: BaileysSocketRequest,
    providerMessageId: string,
    status: "sent" | "delivered" | "read" | "failed",
    timestamp: WAMessage["messageTimestamp"] | null | undefined,
  ): void {
    const providerMessageRef = createProviderMessageRef(request, providerMessageId);
    const occurredAt = occurredAtIso(timestamp, this.nowEpochMilliseconds);
    const failureReasonRef =
      status === "failed"
        ? createFailureReasonRef(request, providerMessageId, "status_failed")
        : undefined;

    this.recordSignal(
      request,
      "message_status",
      `message_${status}`,
      "confidential",
      `message_status.${providerMessageRef}.${status}`,
      undefined,
      {
        instanceId: String(request.instanceId),
        sessionId: String(request.sessionId ?? request.instanceId),
        providerMessageRef,
        status,
        occurredAt,
        ...(failureReasonRef === undefined ? {} : { failureReasonRef }),
      },
    );
  }

  private recordInboundMessage(
    request: BaileysSocketRequest,
    rawMessage: unknown,
    index: number,
  ): void {
    const message = isObjectRecord(rawMessage) ? (rawMessage as Partial<WAMessage>) : undefined;
    const key = isObjectRecord(message?.key) ? message.key : undefined;

    if (key?.fromMe === true) {
      return;
    }

    const providerMessageId = typeof key?.id === "string" ? key.id : undefined;
    const remoteJid = typeof key?.remoteJid === "string" ? key.remoteJid : undefined;

    if (providerMessageId === undefined || remoteJid === undefined) {
      this.recordInboundFailure(request, "malformed_inbound_message", `inbound_malformed.${index}`);
      return;
    }

    const providerMessageRef = createProviderMessageRef(request, providerMessageId);
    const conversationRef = createConversationRef(request, remoteJid);
    const conversationKind = conversationKindFromJid(remoteJid);
    const occurredAt = occurredAtIso(message?.messageTimestamp, this.nowEpochMilliseconds);
    const contentKind = detectInboundContentKind(message?.message);

    this.captureInboundRecipient(request, {
      conversationRef,
      conversationKind,
      recipientJid: remoteJid,
      occurredAt,
    });

    if (contentKind === undefined) {
      this.recordInboundFailure(
        request,
        "unsupported_inbound_message",
        `inbound_unsupported.${providerMessageRef}`,
        {
          providerMessageRef,
          conversationRef,
          contentKind: "unsupported",
          conversationKind,
        },
      );
      return;
    }

    this.recordSignal(
      request,
      "inbound_message",
      "inbound_message",
      "confidential",
      `inbound.${providerMessageRef}`,
      undefined,
      {
        instanceId: String(request.instanceId),
        sessionId: String(request.sessionId ?? request.instanceId),
        providerMessageRef,
        conversationRef,
        occurredAt,
        contentKind,
        conversationKind,
      },
    );
  }

  private captureInboundRecipient(
    request: BaileysSocketRequest,
    input: Readonly<{
      conversationRef: string;
      conversationKind: "private" | "group" | "unknown";
      recipientJid: string;
      occurredAt: string;
    }>,
  ): void {
    if (this.inboundRecipientOperatorSink === undefined) {
      return;
    }

    try {
      this.inboundRecipientOperatorSink.captureInboundRecipient({
        instanceId: request.instanceId,
        providerId: request.providerId,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        conversationRef: input.conversationRef,
        conversationKind: input.conversationKind,
        recipientJid: input.recipientJid,
        occurredAt: input.occurredAt,
        dataClassification: "secret",
        localOnly: true,
      });
    } catch {
      this.recordInboundFailure(
        request,
        "inbound_recipient_operator_sink_failed",
        "inbound_recipient_operator_sink_failed",
        {
          conversationRef: input.conversationRef,
          conversationKind: input.conversationKind,
        },
      );
    }
  }

  private recordStatusFailure(
    request: BaileysSocketRequest,
    reasonCode: string,
    occurrenceCode: string,
    safeMetadata: TranslatedProviderSignal["safeMetadata"] = {},
  ): void {
    this.recordSignal(
      request,
      "failure",
      "message_status_unsupported",
      "confidential",
      occurrenceCode,
      createFailureCategory("provider"),
      {
        instanceId: String(request.instanceId),
        sessionId: String(request.sessionId ?? request.instanceId),
        reasonCode,
        ...safeMetadata,
      },
    );
  }

  private recordInboundFailure(
    request: BaileysSocketRequest,
    reasonCode: string,
    occurrenceCode: string,
    safeMetadata: TranslatedProviderSignal["safeMetadata"] = {},
  ): void {
    this.recordSignal(
      request,
      "failure",
      "inbound_message_unsupported",
      "confidential",
      occurrenceCode,
      createFailureCategory("provider"),
      {
        instanceId: String(request.instanceId),
        sessionId: String(request.sessionId ?? request.instanceId),
        reasonCode,
        ...safeMetadata,
      },
    );
  }

  private async recordDisconnectUpdate(
    request: BaileysSocketRequest,
    update: BaileysEventMap["connection.update"],
  ): Promise<void> {
    const decision = mapBaileysDisconnectReason(
      extractProviderStatusCode(update.lastDisconnect?.error),
    );

    if (decision.clearAuthState && request.sessionId !== undefined) {
      const cleared = await this.authStateStore.clear(request.sessionId);

      if (!cleared.ok) {
        this.recordSignal(
          request,
          "failure",
          "auth_clear_failed",
          "confidential",
          "auth_clear_failed",
          createFailureCategory("provider"),
        );
      }
    }

    this.recordSignal(
      request,
      disconnectSignalKind(decision),
      decision.signalCode,
      disconnectSignalClassification(decision),
      decision.action,
      decision.failureCategory,
    );
  }

  private recordSignal(
    request: BaileysSocketRequest,
    kind: TranslatedProviderSignal["kind"],
    signalCode: string,
    dataClassification: TranslatedProviderSignal["dataClassification"],
    occurrenceCode: string,
    failureCategory?: FailureCategory,
    safeMetadata?: TranslatedProviderSignal["safeMetadata"],
  ): TranslatedProviderSignal {
    const targetRef = request.sessionId ?? request.instanceId;
    const signal = Object.freeze({
      signalRef: `${String(request.providerId)}.${signalCode}`,
      providerId: request.providerId,
      targetRef,
      occurrenceRef: [
        String(request.providerId),
        String(targetRef),
        "real_socket",
        occurrenceCode,
      ].join("."),
      kind,
      dataClassification,
      ...(failureCategory === undefined ? {} : { failureCategory }),
      ...(safeMetadata === undefined ? {} : { safeMetadata: Object.freeze({ ...safeMetadata }) }),
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

export function mapBaileysDisconnectReason(
  statusCode: number | undefined,
): BaileysDisconnectDecision {
  if (
    statusCode === DisconnectReason.loggedOut ||
    statusCode === DisconnectReason.badSession ||
    statusCode === DisconnectReason.multideviceMismatch
  ) {
    return disconnectDecision({
      action: "clear_auth_and_logged_out",
      signalCode: "logged_out",
      retryable: false,
      clearAuthState: true,
      surrenderOwnership: false,
      statusCode,
      failureCategory: createFailureCategory("provider"),
    });
  }

  if (statusCode === DisconnectReason.connectionReplaced) {
    return disconnectDecision({
      action: "surrender_ownership",
      signalCode: "connection_replaced",
      retryable: false,
      clearAuthState: false,
      surrenderOwnership: true,
      statusCode,
      failureCategory: createFailureCategory("provider"),
    });
  }

  if (
    statusCode === DisconnectReason.restartRequired ||
    statusCode === DisconnectReason.connectionClosed ||
    statusCode === DisconnectReason.connectionLost ||
    statusCode === DisconnectReason.timedOut
  ) {
    return disconnectDecision({
      action: "reconnect",
      signalCode: "reconnecting",
      retryable: true,
      clearAuthState: false,
      surrenderOwnership: false,
      backoffMs: 1_000,
      statusCode,
      failureCategory: createFailureCategory("network"),
    });
  }

  if (statusCode === DisconnectReason.forbidden) {
    return disconnectDecision({
      action: "stop_no_retry",
      signalCode: "disconnected",
      retryable: false,
      clearAuthState: false,
      surrenderOwnership: false,
      statusCode,
      failureCategory: createFailureCategory("provider"),
    });
  }

  return disconnectDecision({
    action: "unknown_retryable",
    signalCode: "reconnecting",
    retryable: true,
    clearAuthState: false,
    surrenderOwnership: false,
    backoffMs: 1_000,
    failureCategory: createFailureCategory("unexpected"),
    ...optional("statusCode", statusCode),
  });
}

function socketKey(request: BaileysSocketRequest): string {
  return `${String(request.instanceId)}::${request.sessionId ?? "default"}`;
}

function createQrChallengeRef(request: BaileysSocketRequest, qr: string): string {
  const targetRef = request.sessionId ?? request.instanceId;
  const digest = createHash("sha256")
    .update(String(request.providerId))
    .update(":")
    .update(String(targetRef))
    .update(":")
    .update(qr)
    .digest("hex")
    .slice(0, 16);

  return `qr_challenge_${digest}`;
}

function createProviderMessageRef(
  request: BaileysSocketRequest,
  providerMessageId: string,
): string {
  return `provider_msg_${safeDigest(
    String(request.providerId),
    String(request.sessionId ?? request.instanceId),
    providerMessageId,
  )}`;
}

function createConversationRef(request: BaileysSocketRequest, remoteJid: string): string {
  return `conversation_${safeDigest(
    String(request.providerId),
    String(request.sessionId ?? request.instanceId),
    remoteJid,
  )}`;
}

function createFailureReasonRef(
  request: BaileysSocketRequest,
  providerMessageId: string,
  reasonCode: string,
): string {
  return `failure_reason_${safeDigest(
    String(request.providerId),
    String(request.sessionId ?? request.instanceId),
    providerMessageId,
    reasonCode,
  )}`;
}

function safeDigest(...parts: readonly string[]): string {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(part);
    hash.update(":");
  }

  return hash.digest("hex").slice(0, 16);
}

function isMessageUpsertPayload(
  value: unknown,
): value is Readonly<{ messages: readonly unknown[] }> {
  return isObjectRecord(value) && Array.isArray(value.messages);
}

function readMessageUpdateStatus(rawUpdate: unknown): unknown {
  if (!isObjectRecord(rawUpdate)) {
    return undefined;
  }

  const nestedUpdate = isObjectRecord(rawUpdate.update) ? rawUpdate.update : undefined;

  if (nestedUpdate !== undefined && hasOwnValue(nestedUpdate, "status")) {
    return nestedUpdate.status;
  }

  if (hasOwnValue(rawUpdate, "status")) {
    return rawUpdate.status;
  }

  return undefined;
}

function readMessageUpdateTimestamp(
  rawUpdate: unknown,
): WAMessage["messageTimestamp"] | null | undefined {
  if (!isObjectRecord(rawUpdate)) {
    return undefined;
  }

  const nestedUpdate = isObjectRecord(rawUpdate.update) ? rawUpdate.update : undefined;

  if (nestedUpdate !== undefined && hasOwnValue(nestedUpdate, "messageTimestamp")) {
    return nestedUpdate.messageTimestamp as WAMessage["messageTimestamp"] | null | undefined;
  }

  if (hasOwnValue(rawUpdate, "messageTimestamp")) {
    return rawUpdate.messageTimestamp as WAMessage["messageTimestamp"] | null | undefined;
  }

  return undefined;
}

function mapBaileysReceiptStatus(
  receipt: Readonly<Record<string, unknown>> | undefined,
): "delivered" | "read" | undefined {
  if (receipt === undefined) {
    return undefined;
  }

  if (hasUsableTimestamp(receipt.playedTimestamp) || hasUsableTimestamp(receipt.readTimestamp)) {
    return "read";
  }

  if (
    hasUsableTimestamp(receipt.receiptTimestamp) ||
    (Array.isArray(receipt.deliveredDeviceJid) && receipt.deliveredDeviceJid.length > 0)
  ) {
    return "delivered";
  }

  return undefined;
}

function readMessageReceiptTimestamp(
  receipt: Readonly<Record<string, unknown>> | undefined,
): WAMessage["messageTimestamp"] | null | undefined {
  if (receipt === undefined) {
    return undefined;
  }

  if (hasUsableTimestamp(receipt.playedTimestamp)) {
    return receipt.playedTimestamp as WAMessage["messageTimestamp"];
  }

  if (hasUsableTimestamp(receipt.readTimestamp)) {
    return receipt.readTimestamp as WAMessage["messageTimestamp"];
  }

  if (hasUsableTimestamp(receipt.receiptTimestamp)) {
    return receipt.receiptTimestamp as WAMessage["messageTimestamp"];
  }

  return undefined;
}

function hasUsableTimestamp(timestamp: unknown): boolean {
  return timestampToEpochMilliseconds(timestamp) !== undefined;
}

function isMessageContentOnlyUpdate(update: unknown): boolean {
  return isObjectRecord(update) && hasOwnValue(update, "message") && !hasOwnValue(update, "status");
}

function hasOwnValue(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function mapBaileysMessageStatus(
  status: unknown,
): "sent" | "delivered" | "read" | "failed" | undefined {
  switch (status) {
    case WAMessageStatus.ERROR:
      return "failed";
    case WAMessageStatus.SERVER_ACK:
      return "sent";
    case WAMessageStatus.DELIVERY_ACK:
      return "delivered";
    case WAMessageStatus.READ:
    case WAMessageStatus.PLAYED:
      return "read";
    default:
      return mapBaileysMessageStatusString(status);
  }
}

function mapBaileysMessageStatusString(
  status: unknown,
): "sent" | "delivered" | "read" | "failed" | undefined {
  if (typeof status !== "string") {
    return undefined;
  }

  switch (status.trim().toLowerCase()) {
    case "2":
    case "server_ack":
    case "server-ack":
    case "serverack":
    case "sent":
      return "sent";
    case "3":
    case "delivery_ack":
    case "delivery-ack":
    case "deliveryack":
    case "delivered":
      return "delivered";
    case "4":
    case "5":
    case "read":
    case "played":
      return "read";
    case "0":
    case "error":
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function detectInboundContentKind(
  message: WAMessage["message"] | null | undefined,
):
  | "text"
  | "image"
  | "video"
  | "document"
  | "audio"
  | "sticker"
  | "location"
  | "contact"
  | undefined {
  if (!isObjectRecord(message)) {
    return undefined;
  }

  if (typeof message.conversation === "string" || isObjectRecord(message.extendedTextMessage)) {
    return "text";
  }

  if (isObjectRecord(message.imageMessage)) return "image";
  if (isObjectRecord(message.videoMessage)) return "video";
  if (isObjectRecord(message.documentMessage)) return "document";
  if (isObjectRecord(message.audioMessage)) return "audio";
  if (isObjectRecord(message.stickerMessage)) return "sticker";
  if (isObjectRecord(message.locationMessage)) return "location";
  if (isObjectRecord(message.contactMessage) || isObjectRecord(message.contactsArrayMessage)) {
    return "contact";
  }

  return undefined;
}

function conversationKindFromJid(remoteJid: string): "private" | "group" | "unknown" {
  if (remoteJid.endsWith("@g.us")) {
    return "group";
  }

  if (
    remoteJid.endsWith("@s.whatsapp.net") ||
    remoteJid.endsWith("@c.us") ||
    remoteJid.endsWith("@lid")
  ) {
    return "private";
  }

  return "unknown";
}

function occurredAtIso(
  timestamp: WAMessage["messageTimestamp"] | null | undefined,
  nowEpochMilliseconds: () => number,
): string {
  const epochMilliseconds = timestampToEpochMilliseconds(timestamp) ?? nowEpochMilliseconds();

  return new Date(epochMilliseconds).toISOString();
}

function timestampToEpochMilliseconds(timestamp: unknown): number | undefined {
  const numericTimestamp = numericTimestampValue(timestamp);

  if (numericTimestamp === undefined || numericTimestamp <= 0) {
    return undefined;
  }

  return Math.trunc(
    numericTimestamp > 1_000_000_000_000 ? numericTimestamp : numericTimestamp * 1000,
  );
}

function numericTimestampValue(timestamp: unknown): number | undefined {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (typeof timestamp === "string" && timestamp.trim().length > 0) {
    const parsed = Number(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (typeof timestamp === "bigint") {
    return Number(timestamp);
  }

  if (isObjectRecord(timestamp) && typeof timestamp.toNumber === "function") {
    const value = timestamp.toNumber();
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function disconnectDecision(
  input: Omit<BaileysDisconnectDecision, "statusCode" | "backoffMs"> &
    Readonly<{
      statusCode?: number;
      backoffMs?: number;
    }>,
): BaileysDisconnectDecision {
  return Object.freeze({
    action: input.action,
    signalCode: input.signalCode,
    retryable: input.retryable,
    clearAuthState: input.clearAuthState,
    surrenderOwnership: input.surrenderOwnership,
    failureCategory: input.failureCategory,
    ...optional("backoffMs", input.backoffMs),
    ...optional("statusCode", input.statusCode),
  });
}

function disconnectSignalKind(
  decision: BaileysDisconnectDecision,
): TranslatedProviderSignal["kind"] {
  return decision.action === "reconnect" || decision.action === "unknown_retryable"
    ? "connection"
    : "failure";
}

function disconnectSignalClassification(
  decision: BaileysDisconnectDecision,
): TranslatedProviderSignal["dataClassification"] {
  return decision.action === "reconnect" || decision.action === "unknown_retryable"
    ? "internal"
    : "confidential";
}

function safeSocketProviderFailure(code: string, retryable: boolean): BaileysProviderError {
  return new BaileysProviderError({
    code,
    category: retryable ? "unavailable" : "rejected",
    failureCategory: createFailureCategory("provider"),
    retryable,
    message: "Baileys socket provider failed with a sanitized provider error.",
  });
}

function createSilentBaileysLogger(): NonNullable<UserFacingSocketConfig["logger"]> {
  const logger = DEFAULT_CONNECTION_CONFIG.logger.child({
    class: "omniwa.baileys",
  });

  logger.level = "silent";

  return logger;
}

function createBaileysAuthenticationState(input: {
  sessionId: SessionId;
  authStateStore: BaileysAuthStateStore;
  snapshot: BaileysAuthStateSnapshot | undefined;
}): Readonly<{
  state: AuthenticationState;
  persist: () => Promise<void>;
}> {
  const keyState = mutableKeyStateFromSnapshot(input.snapshot);
  const state: AuthenticationState = {
    creds: credentialsFromSnapshot(input.snapshot),
    keys: createSignalKeyStore(keyState, async () => {
      await persistAuthState(input.authStateStore, input.sessionId, state, keyState);
    }),
  };

  return Object.freeze({
    state,
    persist: () => persistAuthState(input.authStateStore, input.sessionId, state, keyState),
  });
}

async function persistAuthState(
  authStateStore: BaileysAuthStateStore,
  sessionId: SessionId,
  state: AuthenticationState,
  keyState: MutableBaileysKeyState,
): Promise<void> {
  const saved = await authStateStore.save(sessionId, {
    creds: toJsonValue(state.creds),
    keys: toJsonValue(keyState),
  });

  if (!saved.ok) {
    throw safeSocketProviderFailure("baileys_auth_state_save_failed", saved.error.retryable);
  }
}

type MutableBaileysKeyState = Record<string, Record<string, unknown>>;

function credentialsFromSnapshot(
  snapshot: BaileysAuthStateSnapshot | undefined,
): AuthenticationCreds {
  const creds = snapshot?.creds;

  if (isJsonRecord(creds)) {
    return fromJsonValue(creds) as AuthenticationCreds;
  }

  return initAuthCreds();
}

function mutableKeyStateFromSnapshot(
  snapshot: BaileysAuthStateSnapshot | undefined,
): MutableBaileysKeyState {
  const keys = snapshot?.keys;

  if (!isJsonRecord(keys)) {
    return {};
  }

  return fromJsonValue(keys) as MutableBaileysKeyState;
}

function createSignalKeyStore(
  keyState: MutableBaileysKeyState,
  persist: () => Promise<void>,
): SignalKeyStore {
  return {
    get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const values = keyState[String(type)] ?? {};
      const output: Partial<Record<string, SignalDataTypeMap[T]>> = {};

      for (const id of ids) {
        if (values[id] !== undefined) {
          output[id] = values[id] as SignalDataTypeMap[T];
        }
      }

      return output as { [id: string]: SignalDataTypeMap[T] };
    },
    set: async (data: SignalDataSet) => {
      for (const [type, values] of Object.entries(data)) {
        const typedValues = values as Record<string, unknown | null> | undefined;

        if (typedValues === undefined) {
          continue;
        }

        const current = keyState[type] ?? {};

        for (const [id, value] of Object.entries(typedValues)) {
          if (value === null) {
            Reflect.deleteProperty(current, id);
            continue;
          }

          current[id] = value;
        }

        keyState[type] = current;
      }

      await persist();
    },
    clear: async () => {
      for (const key of Object.keys(keyState)) {
        Reflect.deleteProperty(keyState, key);
      }

      await persist();
    },
  };
}

function isJsonRecord(
  value: unknown,
): value is Readonly<Record<string, BaileysAuthStateJsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): BaileysAuthStateJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return Object.freeze({
      __omniwaBinary: "base64",
      value: Buffer.from(value).toString("base64"),
    });
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => toJsonValue(item)));
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== "function")
      .sort(([left], [right]) => left.localeCompare(right));
    const output: Record<string, BaileysAuthStateJsonValue> = {};

    for (const [key, entryValue] of entries) {
      output[key] = toJsonValue(entryValue);
    }

    return Object.freeze(output);
  }

  return null;
}

function fromJsonValue(value: BaileysAuthStateJsonValue): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => fromJsonValue(item));
  }

  if (isJsonRecord(value)) {
    if (value.__omniwaBinary === "base64" && typeof value.value === "string") {
      return Buffer.from(value.value, "base64");
    }

    const output: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      output[key] = fromJsonValue(entryValue);
    }

    return output;
  }

  return value;
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

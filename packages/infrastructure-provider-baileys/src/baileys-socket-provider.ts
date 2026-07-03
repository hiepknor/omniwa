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
  initAuthCreds,
  makeWASocket,
  type AuthenticationCreds,
  type AuthenticationState,
  type BaileysEventMap,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type UserFacingSocketConfig,
  type WAMessage,
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
  private readonly sockets = new Map<string, WASocket>();
  private readonly signals: TranslatedProviderSignal[] = [];

  constructor(options: RealBaileysSocketProviderOptions) {
    this.authStateStore = options.authStateStore;
    this.socketFactory = options.socketFactory ?? makeWASocket;
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

    try {
      const socket = this.socketFactory({
        ...DEFAULT_CONNECTION_CONFIG,
        auth: auth.state,
        emitOwnEvents: false,
        printQRInTerminal: false,
      });

      socket.ev.on("creds.update", (update) => {
        Object.assign(auth.state.creds, update);
        void auth.persist();
      });
      socket.ev.on("connection.update", (update) => {
        this.recordConnectionUpdate(request, update);
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

  private recordConnectionUpdate(
    request: BaileysSocketRequest,
    update: BaileysEventMap["connection.update"],
  ): void {
    if (update.qr !== undefined) {
      this.recordSignal(request, "auth", "qr_required", "confidential", "qr_required");
    }

    if (update.connection === "open") {
      this.recordSignal(request, "connection", "connected", "internal", "connected");
      return;
    }

    if (update.connection === "close") {
      this.recordSignal(request, "connection", "disconnected", "internal", "disconnected");
      return;
    }

    if (update.connection === "connecting") {
      this.recordSignal(request, "connection", "connecting", "internal", "connecting");
    }
  }

  private recordSignal(
    request: BaileysSocketRequest,
    kind: TranslatedProviderSignal["kind"],
    signalCode: string,
    dataClassification: TranslatedProviderSignal["dataClassification"],
    occurrenceCode: string,
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

function safeSocketProviderFailure(code: string, retryable: boolean): BaileysProviderError {
  return new BaileysProviderError({
    code,
    category: retryable ? "unavailable" : "rejected",
    failureCategory: createFailureCategory("provider"),
    retryable,
    message: "Baileys socket provider failed with a sanitized provider error.",
  });
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

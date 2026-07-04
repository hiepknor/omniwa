import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SessionId } from "@omniwa/domain";
import { err, ok, systemClock, type Clock, type Result } from "@omniwa/shared";

export type BaileysAuthStateDataClassification = "secret";

export type BaileysAuthStateJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly BaileysAuthStateJsonValue[]
  | { readonly [key: string]: BaileysAuthStateJsonValue };

export type BaileysAuthStateSnapshot = Readonly<Record<string, BaileysAuthStateJsonValue>>;

export type BaileysAuthStateMetadata = Readonly<{
  sessionId: SessionId;
  revision: number;
  updatedAtEpochMilliseconds: number;
  checksum: string;
  dataClassification: BaileysAuthStateDataClassification;
}>;

export type BaileysAuthStateRecord = BaileysAuthStateMetadata &
  Readonly<{
    state: BaileysAuthStateSnapshot;
    toJSON(): BaileysAuthStateMetadata;
  }>;

export type BaileysAuthStateStoreFailureCategory = "integrity" | "unsafe_payload" | "storage";

export type BaileysAuthStateStoreFailure = Readonly<{
  category: BaileysAuthStateStoreFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  dataClassification: BaileysAuthStateDataClassification;
  safeMetadata?: Readonly<Record<string, string | number | boolean>>;
}>;

export type BaileysAuthStateStoreResult<T> = Result<T, BaileysAuthStateStoreFailure>;

export type BaileysAuthStateStore = Readonly<{
  load(
    sessionId: SessionId,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateRecord | undefined>>;
  save(
    sessionId: SessionId,
    state: BaileysAuthStateSnapshot,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateMetadata>>;
  clear(
    sessionId: SessionId,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateMetadata | undefined>>;
}>;

export type BaileysAuthStateStoreOptions = Readonly<{
  clock?: Pick<Clock, "epochMilliseconds">;
}>;

export type DurableJsonBaileysAuthStateStoreOptions = BaileysAuthStateStoreOptions &
  Readonly<{
    encryptionKey?: string;
  }>;

type StoredBaileysAuthStateRecord = Readonly<{
  sessionId: string;
  state: BaileysAuthStateSnapshot;
  revision: number;
  updatedAtEpochMilliseconds: number;
  checksum: string;
  dataClassification: BaileysAuthStateDataClassification;
}>;

type EncodedBaileysAuthStatePayload =
  | Readonly<{
      encoding: "base64-json";
      value: string;
    }>
  | Readonly<{
      encoding: "aes-256-gcm-json";
      value: string;
      iv: string;
      tag: string;
    }>;

type DurableBaileysAuthStateRecord = Omit<StoredBaileysAuthStateRecord, "state"> &
  Readonly<{
    payload: EncodedBaileysAuthStatePayload;
  }>;

type DurableBaileysAuthStateStoreState = Readonly<{
  records: readonly DurableBaileysAuthStateRecord[];
}>;

type DurableBaileysAuthStateStoreEnvelope = Readonly<{
  version: 1;
  state: DurableBaileysAuthStateStoreState;
}>;

export class InMemoryBaileysAuthStateStore implements BaileysAuthStateStore {
  protected records = new Map<string, StoredBaileysAuthStateRecord>();
  private readonly clock: Pick<Clock, "epochMilliseconds">;

  constructor(options: BaileysAuthStateStoreOptions = {}) {
    this.clock = options.clock ?? systemClock;
  }

  load(
    sessionId: SessionId,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateRecord | undefined>> {
    return Promise.resolve(
      this.captureFailure(() => {
        const record = this.records.get(String(sessionId));

        if (record === undefined) {
          return ok(undefined);
        }

        const integrity = verifyStoredRecord(record);
        if (!integrity.ok) {
          return integrity;
        }

        return ok(freezeLoadedRecord(record));
      }),
    );
  }

  save(
    sessionId: SessionId,
    state: BaileysAuthStateSnapshot,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateMetadata>> {
    return Promise.resolve(
      this.captureFailure(() => {
        const normalizedState = normalizeAuthStateSnapshot(state);
        const existing = this.records.get(String(sessionId));
        const record = freezeStoredRecord({
          sessionId: String(sessionId),
          state: normalizedState,
          revision: existing === undefined ? 1 : existing.revision + 1,
          updatedAtEpochMilliseconds: this.clock.epochMilliseconds(),
          checksum: checksumFor(normalizedState),
          dataClassification: "secret",
        });

        this.records.set(String(sessionId), record);
        this.persist();

        return ok(metadataFor(record, sessionId));
      }),
    );
  }

  clear(
    sessionId: SessionId,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateMetadata | undefined>> {
    return Promise.resolve(
      this.captureFailure(() => {
        const existing = this.records.get(String(sessionId));

        this.records.delete(String(sessionId));
        this.persist();

        return ok(existing === undefined ? undefined : metadataFor(existing, sessionId));
      }),
    );
  }

  corruptChecksumForTest(sessionId: SessionId, checksum: string): void {
    const existing = this.records.get(String(sessionId));

    if (existing === undefined) {
      return;
    }

    this.records.set(
      String(sessionId),
      freezeStoredRecord({
        ...existing,
        checksum,
      }),
    );
  }

  protected persist(): void {
    // In-memory adapter has no external durability boundary.
  }

  private captureFailure<T>(
    action: () => BaileysAuthStateStoreResult<T>,
  ): BaileysAuthStateStoreResult<T> {
    try {
      return action();
    } catch {
      return err(
        authStateFailure({
          category: "unsafe_payload",
          code: "baileys_auth_state_store_rejected",
          message: "Baileys auth state store rejected unsafe auth state input.",
          retryable: false,
        }),
      );
    }
  }
}

export class DurableJsonBaileysAuthStateStore extends InMemoryBaileysAuthStateStore {
  private readonly filePath: string;
  private readonly encryptionKey: string | undefined;

  constructor(filePath: string, options: DurableJsonBaileysAuthStateStoreOptions = {}) {
    super(options);
    this.filePath = filePath;
    this.encryptionKey = options.encryptionKey;
    mkdirSync(dirname(filePath), { recursive: true });
    this.records = recordsFromDurableState(readDurableState(filePath), this.encryptionKey);
  }

  protected override persist(): void {
    const envelope: DurableBaileysAuthStateStoreEnvelope = {
      version: 1,
      state: durableStateFromRecords([...this.records.values()], this.encryptionKey),
    };
    const temporaryPath = `${this.filePath}.tmp`;

    writeFileSync(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
  }

  toJSON(): Readonly<{
    kind: "durable_json_baileys_auth_state_store";
    dataClassification: BaileysAuthStateDataClassification;
    encrypted: boolean;
  }> {
    return Object.freeze({
      kind: "durable_json_baileys_auth_state_store",
      dataClassification: "secret",
      encrypted: this.encryptionKey !== undefined && this.encryptionKey.length > 0,
    });
  }
}

export function checksumForBaileysAuthState(state: BaileysAuthStateSnapshot): string {
  return checksumFor(normalizeAuthStateSnapshot(state));
}

function readDurableState(filePath: string): DurableBaileysAuthStateStoreState {
  if (!existsSync(filePath)) {
    return emptyDurableState();
  }

  const envelope = JSON.parse(
    readFileSync(filePath, "utf8"),
  ) as Partial<DurableBaileysAuthStateStoreEnvelope>;

  if (envelope.version !== 1 || envelope.state === undefined) {
    throw new TypeError("Unsupported Baileys auth state durable JSON version.");
  }

  return envelope.state;
}

function emptyDurableState(): DurableBaileysAuthStateStoreState {
  return Object.freeze({
    records: Object.freeze([]),
  });
}

function recordsFromDurableState(
  state: DurableBaileysAuthStateStoreState,
  encryptionKey: string | undefined,
): Map<string, StoredBaileysAuthStateRecord> {
  const output = new Map<string, StoredBaileysAuthStateRecord>();

  for (const record of state.records) {
    output.set(
      record.sessionId,
      freezeStoredRecord({
        sessionId: record.sessionId,
        state: decodePayload(record.payload, encryptionKey),
        revision: record.revision,
        updatedAtEpochMilliseconds: record.updatedAtEpochMilliseconds,
        checksum: record.checksum,
        dataClassification: "secret",
      }),
    );
  }

  return output;
}

function durableStateFromRecords(
  records: readonly StoredBaileysAuthStateRecord[],
  encryptionKey: string | undefined,
): DurableBaileysAuthStateStoreState {
  return Object.freeze({
    records: Object.freeze(
      records.map((record) =>
        Object.freeze({
          sessionId: record.sessionId,
          revision: record.revision,
          updatedAtEpochMilliseconds: record.updatedAtEpochMilliseconds,
          checksum: record.checksum,
          dataClassification: record.dataClassification,
          payload: encodePayload(record.state, encryptionKey),
        }),
      ),
    ),
  });
}

function encodePayload(
  state: BaileysAuthStateSnapshot,
  encryptionKey: string | undefined,
): EncodedBaileysAuthStatePayload {
  const plaintext = stableStringify(state);

  if (encryptionKey === undefined || encryptionKey.length === 0) {
    return Object.freeze({
      encoding: "base64-json",
      value: Buffer.from(plaintext, "utf8").toString("base64"),
    });
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeyBytes(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return Object.freeze({
    encoding: "aes-256-gcm-json",
    value: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
}

function decodePayload(
  payload: EncodedBaileysAuthStatePayload,
  encryptionKey: string | undefined,
): BaileysAuthStateSnapshot {
  if (payload.encoding === "base64-json") {
    const decoded = JSON.parse(Buffer.from(payload.value, "base64").toString("utf8")) as unknown;
    return normalizeAuthStateSnapshot(decoded);
  }

  if (payload.encoding !== "aes-256-gcm-json") {
    throw new TypeError("Unsupported Baileys auth state payload encoding.");
  }

  if (encryptionKey === undefined || encryptionKey.length === 0) {
    throw new TypeError("Baileys auth state encryption key is required.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKeyBytes(encryptionKey),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decoded = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(payload.value, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as unknown;

  return normalizeAuthStateSnapshot(decoded);
}

function encryptionKeyBytes(encryptionKey: string): Buffer {
  return createHash("sha256").update(encryptionKey, "utf8").digest();
}

function verifyStoredRecord(
  record: StoredBaileysAuthStateRecord,
): BaileysAuthStateStoreResult<StoredBaileysAuthStateRecord> {
  const expectedChecksum = checksumFor(record.state);

  if (record.checksum !== expectedChecksum) {
    return err(
      authStateFailure({
        category: "integrity",
        code: "baileys_auth_state_integrity_mismatch",
        message: "Baileys auth state failed integrity verification.",
        retryable: false,
        safeMetadata: {
          sessionId: record.sessionId,
          revision: record.revision,
        },
      }),
    );
  }

  return ok(record);
}

function metadataFor(
  record: StoredBaileysAuthStateRecord,
  sessionId: SessionId,
): BaileysAuthStateMetadata {
  return Object.freeze({
    sessionId,
    revision: record.revision,
    updatedAtEpochMilliseconds: record.updatedAtEpochMilliseconds,
    checksum: record.checksum,
    dataClassification: "secret",
  });
}

function freezeLoadedRecord(record: StoredBaileysAuthStateRecord): BaileysAuthStateRecord {
  const sessionId = record.sessionId as SessionId;

  return Object.freeze({
    sessionId,
    state: normalizeAuthStateSnapshot(record.state),
    revision: record.revision,
    updatedAtEpochMilliseconds: record.updatedAtEpochMilliseconds,
    checksum: record.checksum,
    dataClassification: "secret",
    toJSON: () => metadataFor(record, sessionId),
  });
}

function freezeStoredRecord(record: StoredBaileysAuthStateRecord): StoredBaileysAuthStateRecord {
  return Object.freeze({
    sessionId: record.sessionId,
    state: normalizeAuthStateSnapshot(record.state),
    revision: record.revision,
    updatedAtEpochMilliseconds: record.updatedAtEpochMilliseconds,
    checksum: record.checksum,
    dataClassification: "secret",
  });
}

function normalizeAuthStateSnapshot(value: unknown): BaileysAuthStateSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Baileys auth state must be a JSON object.");
  }

  return normalizeJsonObject(value as Record<string, unknown>);
}

function normalizeJsonValue(value: unknown): BaileysAuthStateJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Baileys auth state contains a non-finite number.");
    }

    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => normalizeJsonValue(item)));
  }

  if (typeof value === "object") {
    return normalizeJsonObject(value as Record<string, unknown>);
  }

  throw new TypeError("Baileys auth state contains a non-JSON value.");
}

function normalizeJsonObject(value: Record<string, unknown>): BaileysAuthStateSnapshot {
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const output: Record<string, BaileysAuthStateJsonValue> = {};

  for (const [key, entryValue] of entries) {
    output[key] = normalizeJsonValue(entryValue);
  }

  return Object.freeze(output);
}

function stableStringify(state: BaileysAuthStateSnapshot): string {
  return JSON.stringify(normalizeAuthStateSnapshot(state));
}

function checksumFor(state: BaileysAuthStateSnapshot): string {
  return `sha256:${createHash("sha256").update(stableStringify(state)).digest("hex")}`;
}

function authStateFailure(
  failure: Omit<BaileysAuthStateStoreFailure, "dataClassification">,
): BaileysAuthStateStoreFailure {
  return Object.freeze(
    failure.safeMetadata === undefined
      ? {
          ...failure,
          dataClassification: "secret",
        }
      : {
          ...failure,
          dataClassification: "secret",
          safeMetadata: Object.freeze(failure.safeMetadata),
        },
  );
}

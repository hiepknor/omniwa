import type { SecretDescriptor, SecretProvider } from "@omniwa/config";
import { DurableJsonStateStore } from "@omniwa/infrastructure-persistence";
import type { ApiCredential } from "@omniwa/interface-api";

import {
  createHashedApiKeyConfig,
  createHashedApiKeyVerifier,
  revokeApiKey,
  rotateApiKey as rotateHashedApiKey,
  type ApiKeyConfig,
  type ApiKeyHash,
  type ApiKeyStatus,
  type ApiKeyVerifier,
  type HashedApiKeyConfig,
} from "./api-key-auth.js";

export type ApiKeyLifecycleRecord = HashedApiKeyConfig &
  Readonly<{
    createdAt: string;
    updatedAt: string;
    revokedAt?: string;
    revocationReasonCode?: string;
  }>;

export type ApiKeyLifecycleSafeRecord = Readonly<{
  keyId: string;
  kind: ApiCredential["kind"];
  scopes: ApiCredential["scopes"];
  allowedInstanceRefs?: readonly string[];
  status: ApiKeyStatus;
  rotatedFromKeyId?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revocationReasonCode?: string;
}>;

export type ApiKeyLifecycleEventType =
  "api_key_provisioned" | "api_key_rotated" | "api_key_revoked";

export type ApiKeyLifecycleAuditEvent = Readonly<{
  type: ApiKeyLifecycleEventType;
  keyId: string;
  actorRef?: string;
  timestamp: string;
  status: ApiKeyStatus;
  rotatedFromKeyId?: string;
  replacementKeyId?: string;
  reasonCode?: string;
}>;

export type ApiKeyLifecycleAuditSink = Readonly<{
  record(event: ApiKeyLifecycleAuditEvent): Promise<void> | void;
}>;

export interface ApiKeyLifecycleStore {
  listApiKeyRecords(): Promise<readonly ApiKeyLifecycleRecord[]>;
  loadApiKeyRecord(keyId: string): Promise<ApiKeyLifecycleRecord | undefined>;
  saveApiKeyRecord(record: ApiKeyLifecycleRecord): Promise<void>;
}

export type ApiKeyLifecycleServiceOptions = Readonly<{
  store: ApiKeyLifecycleStore;
  auditSink?: ApiKeyLifecycleAuditSink;
  now?: () => Date;
}>;

export type ProvisionApiKeyInput = ApiKeyConfig &
  Readonly<{
    actorRef?: string;
  }>;

export type ProvisionApiKeyFromSecretInput = Readonly<{
  secretProvider: SecretProvider;
  descriptor: SecretDescriptor;
  credential: ApiCredential;
  actorRef?: string;
}>;

export type RevokeApiKeyInput = Readonly<{
  keyId: string;
  actorRef?: string;
  reasonCode?: string;
}>;

export type RotateApiKeyInput = Readonly<{
  currentKeyId: string;
  nextKey: string;
  nextCredential: ApiCredential;
  actorRef?: string;
  reasonCode?: string;
}>;

type ApiKeyLifecycleState = Readonly<{
  records: readonly ApiKeyLifecycleRecord[];
}>;

export class InMemoryApiKeyLifecycleStore implements ApiKeyLifecycleStore {
  private readonly recordsByKeyId = new Map<string, ApiKeyLifecycleRecord>();

  constructor(initialRecords: readonly ApiKeyLifecycleRecord[] = []) {
    for (const record of initialRecords) {
      this.recordsByKeyId.set(record.credential.keyId, freezeLifecycleRecord(record));
    }
  }

  listApiKeyRecords(): Promise<readonly ApiKeyLifecycleRecord[]> {
    return Promise.resolve(Object.freeze([...this.recordsByKeyId.values()]));
  }

  loadApiKeyRecord(keyId: string): Promise<ApiKeyLifecycleRecord | undefined> {
    return Promise.resolve(this.recordsByKeyId.get(keyId));
  }

  saveApiKeyRecord(record: ApiKeyLifecycleRecord): Promise<void> {
    this.recordsByKeyId.set(record.credential.keyId, freezeLifecycleRecord(record));

    return Promise.resolve();
  }
}

export class DurableJsonApiKeyLifecycleStore implements ApiKeyLifecycleStore {
  private readonly store: DurableJsonStateStore<ApiKeyLifecycleState>;

  constructor(filePath: string) {
    this.store = new DurableJsonStateStore(filePath, () => ({
      records: [],
    }));
  }

  listApiKeyRecords(): Promise<readonly ApiKeyLifecycleRecord[]> {
    return Promise.resolve(readStateRecords(this.store));
  }

  loadApiKeyRecord(keyId: string): Promise<ApiKeyLifecycleRecord | undefined> {
    return Promise.resolve(
      readStateRecords(this.store).find((record) => record.credential.keyId === keyId),
    );
  }

  saveApiKeyRecord(record: ApiKeyLifecycleRecord): Promise<void> {
    const records = readStateRecords(this.store);
    const nextRecords = [
      ...records.filter((candidate) => candidate.credential.keyId !== record.credential.keyId),
      freezeLifecycleRecord(record),
    ];

    this.store.write({
      records: Object.freeze(nextRecords),
    });

    return Promise.resolve();
  }
}

export class ApiKeyLifecycleService {
  private readonly store: ApiKeyLifecycleStore;
  private readonly auditSink: ApiKeyLifecycleAuditSink | undefined;
  private readonly now: () => Date;

  constructor(options: ApiKeyLifecycleServiceOptions) {
    this.store = options.store;
    this.auditSink = options.auditSink;
    this.now = options.now ?? (() => new Date());
  }

  async provision(input: ProvisionApiKeyInput): Promise<ApiKeyLifecycleRecord> {
    await assertKeyIdIsAvailable(this.store, input.credential.keyId);

    const timestamp = this.timestamp();
    const config = createHashedApiKeyConfig(input);
    await assertKeyHashIsAvailable(this.store, config.keyHash);

    const record = lifecycleRecordFromConfig(config, timestamp, timestamp);

    await this.store.saveApiKeyRecord(record);
    await this.recordAudit({
      type: "api_key_provisioned",
      keyId: record.credential.keyId,
      status: record.status,
      timestamp,
      ...optional("actorRef", input.actorRef),
    });

    return record;
  }

  async provisionFromSecret(input: ProvisionApiKeyFromSecretInput): Promise<ApiKeyLifecycleRecord> {
    const secret = await input.secretProvider.readSecret(input.descriptor);

    if (!secret.ok) {
      throw new Error(`API key secret unavailable: ${secret.error.code}`);
    }

    return this.provision({
      key: secret.value.revealForUse(),
      credential: input.credential,
      ...optional("actorRef", input.actorRef),
    });
  }

  async revoke(input: RevokeApiKeyInput): Promise<ApiKeyLifecycleRecord> {
    const current = await requireRecord(this.store, input.keyId);

    if (current.status === "revoked") {
      return current;
    }

    const timestamp = this.timestamp();
    const revoked = lifecycleRecordFromConfig(revokeApiKey(current), current.createdAt, timestamp, {
      revokedAt: timestamp,
      ...optional("revocationReasonCode", input.reasonCode),
    });

    await this.store.saveApiKeyRecord(revoked);
    await this.recordAudit({
      type: "api_key_revoked",
      keyId: revoked.credential.keyId,
      status: revoked.status,
      timestamp,
      ...optional("actorRef", input.actorRef),
      ...optional("reasonCode", input.reasonCode),
    });

    return revoked;
  }

  async rotate(input: RotateApiKeyInput): Promise<
    Readonly<{
      revoked: ApiKeyLifecycleRecord;
      replacement: ApiKeyLifecycleRecord;
    }>
  > {
    const current = await requireRecord(this.store, input.currentKeyId);

    if (current.status !== "active") {
      throw new TypeError("Only active API keys can be rotated.");
    }

    await assertKeyIdIsAvailable(this.store, input.nextCredential.keyId);

    const timestamp = this.timestamp();
    const rotation = rotateHashedApiKey({
      current,
      nextKey: input.nextKey,
      nextCredential: input.nextCredential,
    });
    await assertKeyHashIsAvailable(this.store, rotation.replacement.keyHash);

    const revoked = lifecycleRecordFromConfig(rotation.revoked, current.createdAt, timestamp, {
      revokedAt: timestamp,
      ...optional("revocationReasonCode", input.reasonCode ?? "rotated"),
    });
    const replacement = lifecycleRecordFromConfig(rotation.replacement, timestamp, timestamp);

    await this.store.saveApiKeyRecord(revoked);
    await this.store.saveApiKeyRecord(replacement);
    await this.recordAudit({
      type: "api_key_rotated",
      keyId: revoked.credential.keyId,
      status: revoked.status,
      timestamp,
      rotatedFromKeyId: revoked.credential.keyId,
      replacementKeyId: replacement.credential.keyId,
      ...optional("actorRef", input.actorRef),
      ...optional("reasonCode", input.reasonCode ?? "rotated"),
    });

    return Object.freeze({
      revoked,
      replacement,
    });
  }

  async createVerifier(): Promise<ApiKeyVerifier> {
    return createHashedApiKeyVerifier(await this.store.listApiKeyRecords());
  }

  async listSafeRecords(): Promise<readonly ApiKeyLifecycleSafeRecord[]> {
    const records = await this.store.listApiKeyRecords();

    return Object.freeze(records.map(toSafeRecord));
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async recordAudit(event: ApiKeyLifecycleAuditEvent): Promise<void> {
    await this.auditSink?.record(Object.freeze(event));
  }
}

function lifecycleRecordFromConfig(
  config: HashedApiKeyConfig,
  createdAt: string,
  updatedAt: string,
  patch: Partial<Pick<ApiKeyLifecycleRecord, "revokedAt" | "revocationReasonCode">> = {},
): ApiKeyLifecycleRecord {
  return freezeLifecycleRecord({
    ...config,
    createdAt,
    updatedAt,
    ...patch,
  });
}

function freezeLifecycleRecord(record: ApiKeyLifecycleRecord): ApiKeyLifecycleRecord {
  return Object.freeze({
    keyHash: assertApiKeyHash(record.keyHash),
    credential: Object.freeze({
      ...record.credential,
      scopes: Object.freeze([...record.credential.scopes]),
      ...optional(
        "allowedInstanceRefs",
        record.credential.allowedInstanceRefs === undefined
          ? undefined
          : Object.freeze([...record.credential.allowedInstanceRefs]),
      ),
    }),
    status: assertApiKeyStatus(record.status),
    createdAt: assertTimestamp(record.createdAt, "ApiKeyLifecycleRecord.createdAt"),
    updatedAt: assertTimestamp(record.updatedAt, "ApiKeyLifecycleRecord.updatedAt"),
    ...optional("rotatedFromKeyId", nonEmptyOptional(record.rotatedFromKeyId)),
    ...optional(
      "revokedAt",
      optionalTimestamp(record.revokedAt, "ApiKeyLifecycleRecord.revokedAt"),
    ),
    ...optional("revocationReasonCode", nonEmptyOptional(record.revocationReasonCode)),
  });
}

function toSafeRecord(record: ApiKeyLifecycleRecord): ApiKeyLifecycleSafeRecord {
  return Object.freeze({
    keyId: record.credential.keyId,
    kind: record.credential.kind,
    scopes: Object.freeze([...record.credential.scopes]),
    ...optional(
      "allowedInstanceRefs",
      record.credential.allowedInstanceRefs === undefined
        ? undefined
        : Object.freeze([...record.credential.allowedInstanceRefs]),
    ),
    status: record.status,
    ...optional("rotatedFromKeyId", record.rotatedFromKeyId),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...optional("revokedAt", record.revokedAt),
    ...optional("revocationReasonCode", record.revocationReasonCode),
  });
}

function readStateRecords(
  store: DurableJsonStateStore<ApiKeyLifecycleState>,
): readonly ApiKeyLifecycleRecord[] {
  return Object.freeze(store.read().records.map(freezeLifecycleRecord));
}

async function assertKeyIdIsAvailable(store: ApiKeyLifecycleStore, keyId: string): Promise<void> {
  const existing = await store.loadApiKeyRecord(keyId);

  if (existing !== undefined) {
    throw new TypeError("API key id already exists.");
  }
}

async function assertKeyHashIsAvailable(
  store: ApiKeyLifecycleStore,
  keyHash: ApiKeyHash,
): Promise<void> {
  const existing = (await store.listApiKeyRecords()).find((record) => record.keyHash === keyHash);

  if (existing !== undefined) {
    throw new TypeError("API key secret is already registered.");
  }
}

async function requireRecord(
  store: ApiKeyLifecycleStore,
  keyId: string,
): Promise<ApiKeyLifecycleRecord> {
  const record = await store.loadApiKeyRecord(keyId);

  if (record === undefined) {
    throw new TypeError("API key id was not found.");
  }

  return record;
}

function assertApiKeyHash(value: string): ApiKeyHash {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError("ApiKeyLifecycleRecord.keyHash must be a sha256 digest.");
  }

  return value as ApiKeyHash;
}

function assertApiKeyStatus(value: string): ApiKeyStatus {
  if (value !== "active" && value !== "revoked") {
    throw new TypeError("ApiKeyLifecycleRecord.status must be active or revoked.");
  }

  return value;
}

function assertTimestamp(value: string, label: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return value;
}

function optionalTimestamp(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : assertTimestamp(value, label);
}

function nonEmptyOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TypeError("Optional API key lifecycle string fields must not be empty.");
  }

  return normalized;
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

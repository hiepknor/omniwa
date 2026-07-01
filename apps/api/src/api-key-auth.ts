import { createHash, timingSafeEqual } from "node:crypto";

import type { ApiCredential } from "@omniwa/interface-api";

export type ApiKeyConfig = Readonly<{
  key: string;
  credential: ApiCredential;
}>;

export type ApiKeyStatus = "active" | "revoked";

export type HashedApiKeyConfig = Readonly<{
  keyHash: ApiKeyHash;
  credential: ApiCredential;
  status: ApiKeyStatus;
  rotatedFromKeyId?: string;
}>;

export type ApiKeyHash = `sha256:${string}`;

export interface ApiKeyVerifier {
  verify(providedKey: string | undefined): ApiCredential | undefined;
}

type PreparedApiKeyRecord = Readonly<{
  digest: Buffer;
  credential: ApiCredential;
  active: boolean;
}>;

export function hashApiKey(key: string): ApiKeyHash {
  const normalized = normalizeApiKey(key);
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");

  return `sha256:${digest}`;
}

export function createHashedApiKeyConfig(input: ApiKeyConfig): HashedApiKeyConfig {
  return Object.freeze({
    keyHash: hashApiKey(input.key),
    credential: input.credential,
    status: "active",
  });
}

export function revokeApiKey(config: HashedApiKeyConfig): HashedApiKeyConfig {
  return Object.freeze({
    ...config,
    status: "revoked",
  });
}

export function rotateApiKey(input: {
  current: HashedApiKeyConfig;
  nextKey: string;
  nextCredential: ApiCredential;
}): Readonly<{
  revoked: HashedApiKeyConfig;
  replacement: HashedApiKeyConfig;
}> {
  return Object.freeze({
    revoked: revokeApiKey(input.current),
    replacement: Object.freeze({
      keyHash: hashApiKey(input.nextKey),
      credential: input.nextCredential,
      status: "active",
      rotatedFromKeyId: input.current.credential.keyId,
    }),
  });
}

export function createApiKeyVerifierFromPlaintext(
  apiKeys: readonly ApiKeyConfig[],
): ApiKeyVerifier {
  return createHashedApiKeyVerifier(apiKeys.map(createHashedApiKeyConfig));
}

export function createHashedApiKeyVerifier(apiKeys: readonly HashedApiKeyConfig[]): ApiKeyVerifier {
  return new StaticHashedApiKeyVerifier(apiKeys);
}

class StaticHashedApiKeyVerifier implements ApiKeyVerifier {
  private readonly records: readonly PreparedApiKeyRecord[];

  constructor(apiKeys: readonly HashedApiKeyConfig[]) {
    this.records = Object.freeze(apiKeys.map(prepareApiKeyRecord));
  }

  verify(providedKey: string | undefined): ApiCredential | undefined {
    if (providedKey === undefined || providedKey.trim().length === 0) {
      return undefined;
    }

    const providedDigest = parseApiKeyHash(hashApiKey(providedKey));
    let matchedCredential: ApiCredential | undefined;

    for (const record of this.records) {
      if (timingSafeEqual(providedDigest, record.digest) && record.active) {
        matchedCredential = record.credential;
      }
    }

    return matchedCredential;
  }
}

function prepareApiKeyRecord(config: HashedApiKeyConfig): PreparedApiKeyRecord {
  return Object.freeze({
    digest: parseApiKeyHash(config.keyHash),
    credential: config.credential,
    active: config.status === "active",
  });
}

function parseApiKeyHash(hash: ApiKeyHash): Buffer {
  const [algorithm, digest] = hash.split(":");

  if (algorithm !== "sha256" || digest === undefined || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError("ApiKeyHash must use sha256 hex encoding.");
  }

  return Buffer.from(digest, "hex");
}

function normalizeApiKey(key: string): string {
  const normalized = key.trim();

  if (normalized.length === 0) {
    throw new TypeError("API key must not be empty.");
  }

  return normalized;
}

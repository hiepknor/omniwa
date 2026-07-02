import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SecretValue,
  createSecretName,
  createSecretPurpose,
  type SecretDescriptor,
  type SecretProvider,
} from "@omniwa/config";
import type { ApiCredential } from "@omniwa/interface-api";
import { ok } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  ApiKeyLifecycleService,
  DurableJsonApiKeyLifecycleStore,
  InMemoryApiKeyLifecycleStore,
  type ApiKeyLifecycleAuditEvent,
  type ApiKeyLifecycleAuditSink,
} from "./api-key-lifecycle.js";

const temporaryDirectories: string[] = [];

const credential: ApiCredential = {
  kind: "api_key",
  keyId: "api-key-primary",
  scopes: ["instances:read", "messages:send"],
  allowedInstanceRefs: ["inst_allowed"],
};

const rotatedCredential: ApiCredential = {
  ...credential,
  keyId: "api-key-rotated",
};

const fixedNow = () => new Date("2026-07-02T00:00:00.000Z");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ApiKeyLifecycleService", () => {
  it("provisions hashed API keys and creates a verifier without storing plaintext", async () => {
    const audit = new CapturingAuditSink();
    const service = new ApiKeyLifecycleService({
      store: new InMemoryApiKeyLifecycleStore(),
      auditSink: audit,
      now: fixedNow,
    });

    const record = await service.provision({
      key: "primary-secret",
      credential,
      actorRef: "operator:test",
    });
    const verifier = await service.createVerifier();

    expect(record).toMatchObject({
      credential,
      status: "active",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    expect(record.keyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain("primary-secret");
    expect(verifier.verify("primary-secret")).toEqual(credential);
    expect(audit.events).toEqual([
      expect.objectContaining({
        type: "api_key_provisioned",
        keyId: "api-key-primary",
        actorRef: "operator:test",
      }),
    ]);
  });

  it("provisions from SecretProvider without exposing secret material", async () => {
    const service = new ApiKeyLifecycleService({
      store: new InMemoryApiKeyLifecycleStore(),
      now: fixedNow,
    });

    const record = await service.provisionFromSecret({
      secretProvider: new FakeSecretProvider("secret-provider-api-key"),
      descriptor: apiKeySecretDescriptor(),
      credential,
    });
    const verifier = await service.createVerifier();

    expect(record.keyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain("secret-provider-api-key");
    expect(verifier.verify("secret-provider-api-key")).toEqual(credential);
  });

  it("rejects duplicate API key secrets even when key ids differ", async () => {
    const service = new ApiKeyLifecycleService({
      store: new InMemoryApiKeyLifecycleStore(),
      now: fixedNow,
    });

    await service.provision({ key: "duplicate-secret", credential });

    await expect(
      service.provision({
        key: "duplicate-secret",
        credential: {
          ...credential,
          keyId: "api-key-duplicate",
        },
      }),
    ).rejects.toThrow(/already registered/u);
  });

  it("revokes API keys and keeps safe listing free of hashes and plaintext", async () => {
    const audit = new CapturingAuditSink();
    const service = new ApiKeyLifecycleService({
      store: new InMemoryApiKeyLifecycleStore(),
      auditSink: audit,
      now: fixedNow,
    });

    await service.provision({ key: "primary-secret", credential });
    const revoked = await service.revoke({
      keyId: "api-key-primary",
      actorRef: "operator:test",
      reasonCode: "operator_requested",
    });
    const verifier = await service.createVerifier();
    const safeRecords = await service.listSafeRecords();

    expect(revoked).toMatchObject({
      status: "revoked",
      revokedAt: "2026-07-02T00:00:00.000Z",
      revocationReasonCode: "operator_requested",
    });
    expect(verifier.verify("primary-secret")).toBeUndefined();
    expect(JSON.stringify(safeRecords)).not.toContain("primary-secret");
    expect(JSON.stringify(safeRecords)).not.toContain("sha256:");
    expect(safeRecords).toEqual([
      expect.objectContaining({
        keyId: "api-key-primary",
        status: "revoked",
        revocationReasonCode: "operator_requested",
      }),
    ]);
    expect(audit.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "api_key_revoked",
          keyId: "api-key-primary",
          reasonCode: "operator_requested",
        }),
      ]),
    );
  });

  it("rotates API keys by revoking the current record and accepting the replacement", async () => {
    const audit = new CapturingAuditSink();
    const service = new ApiKeyLifecycleService({
      store: new InMemoryApiKeyLifecycleStore(),
      auditSink: audit,
      now: fixedNow,
    });

    await service.provision({ key: "current-secret", credential });
    const rotation = await service.rotate({
      currentKeyId: "api-key-primary",
      nextKey: "next-secret",
      nextCredential: rotatedCredential,
      actorRef: "operator:test",
    });
    const verifier = await service.createVerifier();

    expect(rotation.revoked).toMatchObject({
      status: "revoked",
      revocationReasonCode: "rotated",
    });
    expect(rotation.replacement).toMatchObject({
      status: "active",
      rotatedFromKeyId: "api-key-primary",
      credential: rotatedCredential,
    });
    expect(verifier.verify("current-secret")).toBeUndefined();
    expect(verifier.verify("next-secret")).toEqual(rotatedCredential);
    expect(JSON.stringify(audit.events)).not.toContain("current-secret");
    expect(JSON.stringify(audit.events)).not.toContain("next-secret");
    expect(audit.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "api_key_rotated",
          keyId: "api-key-primary",
          replacementKeyId: "api-key-rotated",
        }),
      ]),
    );
  });

  it("persists only hashed API key lifecycle records in durable JSON storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-key-lifecycle-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "api-keys.json");
    const firstService = new ApiKeyLifecycleService({
      store: new DurableJsonApiKeyLifecycleStore(filePath),
      now: fixedNow,
    });

    await firstService.provision({ key: "durable-secret", credential });

    const persisted = readFileSync(filePath, "utf8");
    const secondService = new ApiKeyLifecycleService({
      store: new DurableJsonApiKeyLifecycleStore(filePath),
      now: fixedNow,
    });
    const verifier = await secondService.createVerifier();

    expect(persisted).toContain("sha256:");
    expect(persisted).not.toContain("durable-secret");
    expect(verifier.verify("durable-secret")).toEqual(credential);
  });
});

class CapturingAuditSink implements ApiKeyLifecycleAuditSink {
  readonly events: ApiKeyLifecycleAuditEvent[] = [];

  record(event: ApiKeyLifecycleAuditEvent): void {
    this.events.push(event);
  }
}

class FakeSecretProvider implements SecretProvider {
  constructor(private readonly value: string) {}

  readSecret(descriptor: SecretDescriptor): ReturnType<SecretProvider["readSecret"]> {
    void descriptor;

    return Promise.resolve(ok(SecretValue.fromString(this.value)));
  }
}

function apiKeySecretDescriptor(): SecretDescriptor {
  return Object.freeze({
    name: createSecretName("OMNIWA_API_KEY"),
    purpose: createSecretPurpose("api-authentication"),
  });
}

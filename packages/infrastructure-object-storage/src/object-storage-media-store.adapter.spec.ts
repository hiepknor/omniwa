import { createMediaId, createRetentionPolicy } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  ObjectStorageAdapterError,
  ObjectStorageMediaStoreAdapter,
  type ObjectStorageAccessRequest,
  type ObjectStorageAccessResult,
  type ObjectStorageDeleteRequest,
  type ObjectStorageDeleteResult,
  type ObjectStorageGateway,
  type ObjectStoragePutRequest,
  type ObjectStoragePutResult,
} from "./object-storage-media-store.adapter.js";

const mediaId = createMediaId("media_object_1");
const context = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("object-storage-correlation"),
    requestId: createRequestId("object-storage-request"),
  }),
  actorRef: "worker.media",
  dataClassification: "internal" as const,
};
const mediaRetention = createRetentionPolicy({
  category: "media_metadata",
  retentionDays: 30,
});
const diagnosticRetention = createRetentionPolicy({
  category: "diagnostic_capture",
  retentionDays: 7,
});

describe("ObjectStorageMediaStoreAdapter", () => {
  it("registers temporary media artifacts without retaining binary by default", async () => {
    const gateway = new FakeObjectStorageGateway();
    const adapter = new ObjectStorageMediaStoreAdapter({ gateway });
    const sourceContentRef = "raw-jid:user@s.whatsapp.net/provider-payload-secret";

    const result = await adapter.registerArtifact(
      {
        mediaId,
        category: "image",
        purpose: "message_attachment",
        sourceContentRef,
        dataClassification: "confidential",
        retentionPolicy: mediaRetention,
      },
      context,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value).toMatchObject({
      mediaId,
      retained: false,
    });
    expect(result.value.artifactRef).not.toContain(sourceContentRef);
    expect(gateway.puts).toHaveLength(1);
    expect(gateway.puts[0]?.objectKey).toMatch(
      /^omniwa\/media\/message_attachment\/confidential\/media_metadata\/[a-f0-9]{32}$/u,
    );
    expect(gateway.puts[0]?.objectKey).not.toContain("user@s.whatsapp.net");
    expect(adapter.snapshot()).toHaveLength(1);
    expect(JSON.stringify(adapter.snapshot())).not.toContain(sourceContentRef);
  });

  it("creates bounded access references and removes artifacts by media id", async () => {
    const gateway = new FakeObjectStorageGateway();
    const adapter = new ObjectStorageMediaStoreAdapter({ gateway });

    await adapter.registerArtifact(
      {
        mediaId,
        category: "document",
        purpose: "diagnostic_capture",
        sourceContentRef: "diagnostic.source.ref",
        dataClassification: "confidential",
        retentionPolicy: diagnosticRetention,
      },
      context,
    );

    const access = await adapter.createAccessReference(mediaId, context);
    const removed = await adapter.removeArtifact(mediaId, "diagnostic_cleanup", context);
    const afterRemoval = await adapter.createAccessReference(mediaId, context);

    expect(access.ok ? access.value : undefined).toMatchObject({
      mediaId,
      accessRef: "object-access://1",
      expiresAtEpochMilliseconds: 1_804_000_900_000,
    });
    expect(removed.ok ? removed.value : undefined).toMatchObject({
      mediaId,
      retained: false,
    });
    expect(afterRemoval.ok).toBe(false);
    expect(afterRemoval.ok ? undefined : afterRemoval.error).toMatchObject({
      category: "rejected",
      code: "media_artifact_not_registered",
      ownerContext: "media",
    });
    expect(gateway.deletes).toEqual([
      expect.objectContaining({
        mediaId,
        reasonCode: "diagnostic_cleanup",
      }),
    ]);
  });

  it("rejects diagnostic artifacts that exceed approved retention", async () => {
    const gateway = new FakeObjectStorageGateway();
    const adapter = new ObjectStorageMediaStoreAdapter({ gateway });

    const result = await adapter.registerArtifact(
      {
        mediaId,
        category: "video",
        purpose: "diagnostic_capture",
        sourceContentRef: "diagnostic.too.long",
        dataClassification: "confidential",
        retentionPolicy: createRetentionPolicy({
          category: "diagnostic_capture",
          retentionDays: 8,
        }),
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unsafe_payload",
      code: "diagnostic_retention_exceeds_limit",
      ownerContext: "media",
      failureCategory: "media",
    });
    expect(gateway.puts).toHaveLength(0);
  });

  it("rejects unsafe gateway references that expose the source content ref", async () => {
    const gateway = new FakeObjectStorageGateway({
      putResult: {
        artifactRef: "object://unsafe/source.ref",
      },
    });
    const adapter = new ObjectStorageMediaStoreAdapter({ gateway });

    const result = await adapter.registerArtifact(
      {
        mediaId,
        category: "audio",
        purpose: "message_attachment",
        sourceContentRef: "source.ref",
        dataClassification: "internal",
        retentionPolicy: mediaRetention,
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unsafe_payload",
      code: "unsafe_object_storage_reference",
      ownerContext: "media",
    });
    expect(adapter.snapshot()).toHaveLength(0);
  });

  it("sanitizes raw object storage failures before crossing MediaStore port", async () => {
    const gateway = new FakeObjectStorageGateway({
      putError: new Error("raw bucket secret credential leaked"),
    });
    const adapter = new ObjectStorageMediaStoreAdapter({ gateway });

    const result = await adapter.registerArtifact(
      {
        mediaId,
        category: "image",
        purpose: "message_attachment",
        sourceContentRef: "media.source",
        dataClassification: "internal",
        retentionPolicy: mediaRetention,
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unknown",
      code: "object_storage_failure",
      retryable: true,
      ownerContext: "media",
      failureCategory: "unexpected",
    });
    expect(JSON.stringify(result.ok ? undefined : result.error)).not.toContain("secret");
  });

  it("maps explicit object storage adapter errors safely", async () => {
    const gateway = new FakeObjectStorageGateway({
      accessError: new ObjectStorageAdapterError({
        category: "unavailable",
        code: "object_storage_unavailable",
        message: "Object storage is unavailable.",
        retryable: true,
        failureCategory: "network",
      }),
    });
    const adapter = new ObjectStorageMediaStoreAdapter({ gateway });

    await adapter.registerArtifact(
      {
        mediaId,
        category: "image",
        purpose: "message_attachment",
        sourceContentRef: "media.source",
        dataClassification: "internal",
        retentionPolicy: mediaRetention,
      },
      context,
    );

    const result = await adapter.createAccessReference(mediaId, context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unavailable",
      code: "object_storage_unavailable",
      message: "Object storage is unavailable.",
      retryable: true,
      ownerContext: "media",
      failureCategory: "network",
    });
  });
});

class FakeObjectStorageGateway implements ObjectStorageGateway {
  readonly puts: ObjectStoragePutRequest[] = [];
  readonly accesses: ObjectStorageAccessRequest[] = [];
  readonly deletes: ObjectStorageDeleteRequest[] = [];
  private accessCount = 0;
  private readonly putResult: ObjectStoragePutResult | undefined;
  private readonly putError: unknown;
  private readonly accessError: unknown;

  constructor(options: {
    putResult?: ObjectStoragePutResult;
    putError?: unknown;
    accessError?: unknown;
  } = {}) {
    this.putResult = options.putResult;
    this.putError = options.putError;
    this.accessError = options.accessError;
  }

  putObject(request: ObjectStoragePutRequest): ObjectStoragePutResult {
    if (this.putError !== undefined) {
      throw this.putError;
    }

    this.puts.push(request);
    return this.putResult ?? { artifactRef: `object://${request.objectKey}` };
  }

  createAccessReference(request: ObjectStorageAccessRequest): ObjectStorageAccessResult {
    if (this.accessError !== undefined) {
      throw this.accessError;
    }

    this.accesses.push(request);
    this.accessCount += 1;

    return {
      accessRef: `object-access://${this.accessCount}`,
      expiresAtEpochMilliseconds: 1_804_000_900_000,
    };
  }

  deleteObject(request: ObjectStorageDeleteRequest): ObjectStorageDeleteResult {
    this.deletes.push(request);
    return { deleted: true };
  }
}

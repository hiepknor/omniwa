import { createHash } from "node:crypto";

import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type MediaAccessReference,
  type MediaArtifactDescriptor,
  type MediaArtifactReceipt,
  type MediaStorePort,
} from "@omniwa/application";
import { createFailureCategory, type FailureCategory, type MediaId } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

export type ObjectStoragePutRequest = Readonly<{
  objectKey: string;
  sourceContentRef: string;
  dataClassification: MediaArtifactDescriptor["dataClassification"];
  retentionCategory: MediaArtifactDescriptor["retentionPolicy"]["category"];
  retentionDays: number;
  purpose: MediaArtifactDescriptor["purpose"];
  mediaCategory: MediaArtifactDescriptor["category"];
}>;

export type ObjectStoragePutResult = Readonly<{
  artifactRef: string;
}>;

export type ObjectStorageAccessRequest = Readonly<{
  objectKey: string;
  mediaId: MediaId;
}>;

export type ObjectStorageAccessResult = Readonly<{
  accessRef: string;
  expiresAtEpochMilliseconds?: number;
}>;

export type ObjectStorageDeleteRequest = Readonly<{
  objectKey: string;
  mediaId: MediaId;
  reasonCode: string;
}>;

export type ObjectStorageDeleteResult = Readonly<{
  deleted: boolean;
}>;

export type ObjectStorageGateway = Readonly<{
  putObject(
    request: ObjectStoragePutRequest,
    context: ApplicationPortContext,
  ): Promise<ObjectStoragePutResult> | ObjectStoragePutResult;
  createAccessReference(
    request: ObjectStorageAccessRequest,
    context: ApplicationPortContext,
  ): Promise<ObjectStorageAccessResult> | ObjectStorageAccessResult;
  deleteObject(
    request: ObjectStorageDeleteRequest,
    context: ApplicationPortContext,
  ): Promise<ObjectStorageDeleteResult> | ObjectStorageDeleteResult;
}>;

export type ObjectStorageMediaStoreOptions = Readonly<{
  gateway: ObjectStorageGateway;
  keyPrefix?: string;
  maxDiagnosticRetentionDays?: number;
}>;

export class ObjectStorageAdapterError extends Error {
  readonly code: string;
  readonly category: ApplicationPortFailureCategory;
  readonly failureCategory: FailureCategory;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    category: ApplicationPortFailureCategory;
    failureCategory: FailureCategory;
    retryable: boolean;
    message: string;
  }) {
    super(input.message);
    this.name = "ObjectStorageAdapterError";
    this.code = input.code;
    this.category = input.category;
    this.failureCategory = input.failureCategory;
    this.retryable = input.retryable;
  }
}

export class ObjectStorageMediaStoreAdapter implements MediaStorePort {
  private readonly gateway: ObjectStorageGateway;
  private readonly keyPrefix: string;
  private readonly maxDiagnosticRetentionDays: number;
  private readonly artifactByMediaId = new Map<string, StoredMediaArtifact>();

  constructor(options: ObjectStorageMediaStoreOptions) {
    this.gateway = options.gateway;
    this.keyPrefix = normalizeKeyPrefix(options.keyPrefix ?? "omniwa/media");
    this.maxDiagnosticRetentionDays = options.maxDiagnosticRetentionDays ?? 7;
  }

  async registerArtifact(
    artifact: MediaArtifactDescriptor,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<MediaArtifactReceipt>> {
    try {
      this.assertArtifactSafe(artifact);

      const objectKey = createObjectKey(this.keyPrefix, artifact);
      const result = await this.gateway.putObject(
        {
          objectKey,
          sourceContentRef: artifact.sourceContentRef,
          dataClassification: artifact.dataClassification,
          retentionCategory: artifact.retentionPolicy.category,
          retentionDays: artifact.retentionPolicy.retentionDays,
          purpose: artifact.purpose,
          mediaCategory: artifact.category,
        },
        context,
      );

      assertSafeReturnedReference(result.artifactRef, artifact.sourceContentRef, "artifactRef");

      const stored = freezeStoredMediaArtifact({
        mediaId: artifact.mediaId,
        objectKey,
        artifactRef: result.artifactRef,
        sourceContentRef: artifact.sourceContentRef,
        retained: artifact.purpose === "diagnostic_capture",
      });

      this.artifactByMediaId.set(mediaKey(artifact.mediaId), stored);

      return ok(
        freezeMediaArtifactReceipt({
          mediaId: artifact.mediaId,
          artifactRef: result.artifactRef,
          retained: stored.retained,
        }),
      );
    } catch (error) {
      return err(objectStorageErrorToPortFailure(error, "register_artifact"));
    }
  }

  async createAccessReference(
    mediaId: MediaId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<MediaAccessReference>> {
    const stored = this.artifactByMediaId.get(mediaKey(mediaId));

    if (stored === undefined) {
      return err(
        objectStoragePortFailure({
          category: "rejected",
          code: "media_artifact_not_registered",
          message: "Media artifact is not registered with object storage.",
          retryable: false,
          failureCategory: createFailureCategory("media"),
          operation: "create_access_reference",
        }),
      );
    }

    try {
      const access = await this.gateway.createAccessReference(
        {
          objectKey: stored.objectKey,
          mediaId,
        },
        context,
      );

      assertSafeReturnedReference(access.accessRef, stored.sourceContentRef, "accessRef");

      return ok(
        freezeMediaAccessReference(
          access.expiresAtEpochMilliseconds === undefined
            ? {
                mediaId,
                accessRef: access.accessRef,
              }
            : {
                mediaId,
                accessRef: access.accessRef,
                expiresAtEpochMilliseconds: access.expiresAtEpochMilliseconds,
              },
        ),
      );
    } catch (error) {
      return err(objectStorageErrorToPortFailure(error, "create_access_reference"));
    }
  }

  async removeArtifact(
    mediaId: MediaId,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<MediaArtifactReceipt>> {
    const stored = this.artifactByMediaId.get(mediaKey(mediaId));

    if (stored === undefined) {
      return err(
        objectStoragePortFailure({
          category: "rejected",
          code: "media_artifact_not_registered",
          message: "Media artifact is not registered with object storage.",
          retryable: false,
          failureCategory: createFailureCategory("media"),
          operation: "remove_artifact",
        }),
      );
    }

    try {
      await this.gateway.deleteObject(
        {
          objectKey: stored.objectKey,
          mediaId,
          reasonCode,
        },
        context,
      );
      this.artifactByMediaId.delete(mediaKey(mediaId));

      return ok(
        freezeMediaArtifactReceipt({
          mediaId,
          artifactRef: stored.artifactRef,
          retained: false,
        }),
      );
    } catch (error) {
      return err(objectStorageErrorToPortFailure(error, "remove_artifact"));
    }
  }

  snapshot(): readonly ObjectStorageMediaArtifactSnapshot[] {
    return Object.freeze(
      [...this.artifactByMediaId.values()].map((artifact) =>
        freezeObjectStorageMediaArtifactSnapshot({
          mediaId: artifact.mediaId,
          objectKey: artifact.objectKey,
          artifactRef: artifact.artifactRef,
          retained: artifact.retained,
        }),
      ),
    );
  }

  private assertArtifactSafe(artifact: MediaArtifactDescriptor): void {
    if (artifact.sourceContentRef.trim().length === 0) {
      throw new ObjectStorageAdapterError({
        category: "unsafe_payload",
        code: "media_source_ref_missing",
        message: "Media artifact source reference is required.",
        retryable: false,
        failureCategory: createFailureCategory("media"),
      });
    }

    if (
      artifact.purpose === "diagnostic_capture" &&
      artifact.retentionPolicy.retentionDays > this.maxDiagnosticRetentionDays
    ) {
      throw new ObjectStorageAdapterError({
        category: "unsafe_payload",
        code: "diagnostic_retention_exceeds_limit",
        message: "Diagnostic media artifacts must not exceed the approved retention limit.",
        retryable: false,
        failureCategory: createFailureCategory("media"),
      });
    }
  }
}

export type ObjectStorageMediaArtifactSnapshot = Readonly<{
  mediaId: MediaId;
  objectKey: string;
  artifactRef: string;
  retained: boolean;
}>;

type StoredMediaArtifact = ObjectStorageMediaArtifactSnapshot &
  Readonly<{
    sourceContentRef: string;
  }>;

function createObjectKey(prefix: string, artifact: MediaArtifactDescriptor): string {
  const digest = createHash("sha256")
    .update(
      [
        String(artifact.mediaId),
        artifact.category,
        artifact.purpose,
        artifact.dataClassification,
        artifact.retentionPolicy.category,
        artifact.sourceContentRef,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);

  return [
    prefix,
    artifact.purpose,
    artifact.dataClassification,
    artifact.retentionPolicy.category,
    digest,
  ].join("/");
}

function normalizeKeyPrefix(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/gu, "");

  if (!/^[a-z0-9][a-z0-9/_-]*$/u.test(normalized)) {
    throw new TypeError("Object storage key prefix must be a safe lowercase path.");
  }

  return normalized;
}

function assertSafeReturnedReference(reference: string, sourceContentRef: string, label: string): void {
  if (reference.trim().length === 0 || reference.includes(sourceContentRef)) {
    throw new ObjectStorageAdapterError({
      category: "unsafe_payload",
      code: "unsafe_object_storage_reference",
      message: `${label} must be non-empty and must not expose the source content reference.`,
      retryable: false,
      failureCategory: createFailureCategory("media"),
    });
  }
}

function objectStorageErrorToPortFailure(
  error: unknown,
  operation: string,
): ApplicationPortFailure {
  if (error instanceof ObjectStorageAdapterError) {
    return objectStoragePortFailure({
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      failureCategory: error.failureCategory,
      operation,
    });
  }

  return objectStoragePortFailure({
    category: "unknown",
    code: "object_storage_failure",
    message: "Object storage operation failed with a sanitized storage error.",
    retryable: true,
    failureCategory: createFailureCategory("unexpected"),
    operation,
  });
}

function objectStoragePortFailure(input: {
  category: ApplicationPortFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  failureCategory: FailureCategory;
  operation: string;
}): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: input.category,
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ownerContext: "media",
    failureCategory: input.failureCategory,
    safeMetadata: {
      operation: input.operation,
    },
  });
}

function mediaKey(mediaId: MediaId): string {
  return String(mediaId);
}

function freezeStoredMediaArtifact(artifact: StoredMediaArtifact): StoredMediaArtifact {
  return Object.freeze(artifact);
}

function freezeObjectStorageMediaArtifactSnapshot(
  artifact: ObjectStorageMediaArtifactSnapshot,
): ObjectStorageMediaArtifactSnapshot {
  return Object.freeze(artifact);
}

function freezeMediaArtifactReceipt(receipt: MediaArtifactReceipt): MediaArtifactReceipt {
  return Object.freeze(receipt);
}

function freezeMediaAccessReference(reference: MediaAccessReference): MediaAccessReference {
  return Object.freeze(reference);
}

import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import type { ApplicationPortContext } from "@omniwa/application";
import { describe, expect, it } from "vitest";

import {
  createInMemoryReadProjectionStore,
  getReadProjectionDefinition,
  listReadProjectionDefinitions,
  readProjectionNames,
} from "./read-projection-store.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("projection-correlation"),
    requestId: createRequestId("projection-request"),
  }),
};

describe("in-memory read projection store", () => {
  it("catalogs approved read projections with source ownership and query traceability", () => {
    const definitions = listReadProjectionDefinitions();

    expect(definitions).toHaveLength(readProjectionNames.length);
    expect(new Set(definitions.map((definition) => definition.name))).toEqual(
      new Set(readProjectionNames),
    );
    expect(getReadProjectionDefinition("MessageStatusProjection")).toMatchObject({
      ownerContext: "messaging",
      sourceAggregates: ["Message", "WorkerJob", "WebhookDelivery"],
      queries: ["GetMessageStatus"],
      consistency: "strong_owner",
      rebuildable: true,
    });
    expect(getReadProjectionDefinition("AuditRecordProjection")).toMatchObject({
      ownerContext: "audit",
      retentionBound: true,
    });
  });

  it("projects and reads safe models with explicit freshness", async () => {
    const store = createInMemoryReadProjectionStore();

    const projectResult = await store.project(
      {
        projectionName: "InstanceStatusProjection",
        projectionKey: "instance-1",
        model: {
          instanceId: "instance-1",
          status: "connected",
        },
        refreshedAtEpochMilliseconds: 1234,
        version: "v1",
      },
      context,
    );

    expect(projectResult).toMatchObject({ ok: true });

    const readResult = await store.read(
      {
        projectionName: "InstanceStatusProjection",
        projectionKey: "instance-1",
      },
      context,
    );

    expect(readResult.ok).toBe(true);
    expect(readResult.ok ? readResult.value : undefined).toEqual({
      model: {
        instanceId: "instance-1",
        status: "connected",
      },
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1234,
      },
    });
    expect(
      store.readStoredProjection({
        projectionName: "InstanceStatusProjection",
        projectionKey: "instance-1",
      }),
    ).toMatchObject({
      version: "v1",
    });
  });

  it("returns a safe port failure when projection state is unavailable", async () => {
    const store = createInMemoryReadProjectionStore();

    const result = await store.read(
      {
        projectionName: "HealthStatusProjection",
        projectionKey: "missing",
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unavailable",
      code: "read_projection_not_found",
      retryable: true,
      ownerContext: "health",
      safeMetadata: {
        projectionName: "HealthStatusProjection",
        projectionKey: "missing",
      },
    });
  });
});

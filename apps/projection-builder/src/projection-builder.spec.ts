import type { ApplicationPortContext } from "@omniwa/application";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createProjectionBuilderRuntime, summarizeProjectionBuilderRuntime } from "./index.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("projection-builder-correlation"),
    requestId: createRequestId("projection-builder-request"),
  }),
};

describe("projection builder runtime", () => {
  it("exposes the approved projection catalog", () => {
    const runtime = createProjectionBuilderRuntime();
    const summary = summarizeProjectionBuilderRuntime(runtime);

    expect(summary.projectionCount).toBeGreaterThan(20);
    expect(summary.rebuildableCount).toBe(summary.projectionCount);
    expect(runtime.definitions.map((definition) => definition.name)).toContain(
      "DashboardSummaryProjection",
    );
    expect(runtime.definitions.map((definition) => definition.name)).toContain(
      "MessageTimelineProjection",
    );
    expect(runtime.definitions.map((definition) => definition.name)).toContain(
      "EventLogProjection",
    );
  });

  it("projects and reads derived platform client views", async () => {
    const runtime = createProjectionBuilderRuntime();

    const projectResult = await runtime.project(
      {
        projectionName: "DashboardSummaryProjection",
        projectionKey: "default",
        model: {
          instances: { connected: 1, disconnected: 0 },
          queue: { pending: 0 },
        },
        refreshedAtEpochMilliseconds: 42,
      },
      context,
    );

    expect(projectResult).toMatchObject({ ok: true });
    expect(runtime.list("DashboardSummaryProjection")).toHaveLength(1);

    const readResult = await runtime.read(
      {
        projectionName: "DashboardSummaryProjection",
        projectionKey: "default",
      },
      context,
    );

    expect(readResult.ok ? readResult.value : undefined).toMatchObject({
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 42,
      },
    });
  });
});
